"use client";

/**
 * League match scoreboards (docs/LEAGUE_UI_PLAN.md step 9): the saved map
 * scoreboards everyone sees on the match page, and the Match Staff editor
 * (one map at a time; paste /ocr2rank output to fill it).
 */
import { useState } from "react";
import { ClipboardPaste, Trash2 } from "lucide-react";
import {
  matchRosterName,
  parseOcrPaste,
  type MapScoreboard,
  type StatLine,
} from "@/lib/league-stats-rules";

interface Team {
  id: string;
  name: string;
  tag: string;
  roster: { discordId: string; name: string }[];
}

const kd = (k: number, d: number) => (d ? (k / d).toFixed(2) : k.toFixed(2));

function TeamTable({ team, rows, won }: { team: Team; rows: StatLine[]; won: boolean }) {
  const th = "px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45";
  return (
    <div className="min-w-0">
      <div className={`mb-1.5 text-xs font-black ${won ? "text-hl-green" : "text-white/80"}`}>
        {team.name} {won ? "· won" : ""}
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="bg-white/[0.03] text-right">
              <th className={`${th} text-left`}>Player</th>
              <th className={th}>K</th>
              <th className={th}>D</th>
              <th className={th}>A</th>
              <th className={th}>K/D</th>
              <th className={th}>HS%</th>
              <th className={th}>MVP</th>
              <th className={`${th} pr-3`}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.discordId} className="border-t border-white/[0.04] text-right tabular-nums text-white/80">
                <td className="px-2 py-1.5 text-left font-bold text-white">{p.name}</td>
                <td className="px-2 py-1.5">{p.kills}</td>
                <td className="px-2 py-1.5">{p.deaths}</td>
                <td className="px-2 py-1.5">{p.assists}</td>
                <td className={`px-2 py-1.5 ${p.kills >= p.deaths ? "text-hl-green" : "text-hl-red"}`}>{kd(p.kills, p.deaths)}</td>
                <td className="px-2 py-1.5">{p.hs.toFixed(1)}</td>
                <td className="px-2 py-1.5">{p.mvps}</td>
                <td className="px-2 py-1.5 pr-3 font-bold text-white">{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Everyone: the saved scoreboards, one card per map. */
export function LeagueScoreboards({ maps, teamA, teamB }: { maps: MapScoreboard[]; teamA: Team; teamB: Team }) {
  if (!maps.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-black text-white">Scoreboard</h2>
      {maps.map((m) => (
        <div key={m.mapNo} className="rounded-xl border border-white/[0.08] bg-[#121212] p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-black text-white">
              {maps.length > 1 ? `Map ${m.mapNo}` : "Map"}
              {m.mapName ? <span className="ml-2 font-bold text-white/60">{m.mapName}</span> : null}
            </span>
            <span className="text-sm font-black tabular-nums text-white">
              {teamA.tag || teamA.name} {m.roundsA} – {m.roundsB} {teamB.tag || teamB.name}
            </span>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <TeamTable team={teamA} rows={m.players.filter((p) => p.teamId === teamA.id)} won={m.roundsA > m.roundsB} />
            <TeamTable team={teamB} rows={m.players.filter((p) => p.teamId === teamB.id)} won={m.roundsB > m.roundsA} />
          </div>
        </div>
      ))}
    </section>
  );
}

// --- staff editor ----------------------------------------------------------------------------

type Cell = "kills" | "deaths" | "assists" | "mvps" | "score" | "hs";
const CELLS: [Cell, string][] = [
  ["kills", "K"],
  ["deaths", "D"],
  ["assists", "A"],
  ["mvps", "MVP"],
  ["score", "Score"],
  ["hs", "HS%"],
];

interface Draft {
  mapName: string;
  roundsA: string;
  roundsB: string;
  /** discord id → the player's line (played = in the payload). */
  lines: Record<string, { played: boolean } & Record<Cell, string>>;
}

function draftFrom(teams: Team[], saved: MapScoreboard | null, bo1Score: [number, number] | null): Draft {
  const lines: Draft["lines"] = {};
  for (const t of teams) {
    t.roster.forEach((p, i) => {
      const s = saved?.players.find((x) => x.discordId === p.discordId);
      lines[p.discordId] = {
        // Nothing saved yet: the first 5 of each roster are ticked.
        played: saved ? !!s : i < 5,
        kills: s ? String(s.kills) : "",
        deaths: s ? String(s.deaths) : "",
        assists: s ? String(s.assists) : "",
        mvps: s ? String(s.mvps) : "",
        score: s ? String(s.score) : "",
        hs: s ? String(s.hs) : "",
      };
    });
  }
  return {
    mapName: saved?.mapName ?? "",
    roundsA: saved ? String(saved.roundsA) : bo1Score ? String(bo1Score[0]) : "",
    roundsB: saved ? String(saved.roundsB) : bo1Score ? String(bo1Score[1]) : "",
    lines,
  };
}

function MapEditor({
  mapNo,
  bo,
  teamA,
  teamB,
  saved,
  bo1Score,
  busy,
  onSave,
  onDelete,
}: {
  mapNo: number;
  bo: number;
  teamA: Team;
  teamB: Team;
  saved: MapScoreboard | null;
  bo1Score: [number, number] | null;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom([teamA, teamB], saved, bo1Score));
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const setLine = (id: string, patch: Partial<Draft["lines"][string]>) =>
    setD((x) => ({ ...x, lines: { ...x.lines, [id]: { ...x.lines[id], ...patch } } }));

  const fillFromPaste = () => {
    const parsed = parseOcrPaste(paste);
    if (!parsed) {
      setNote("That doesn't look like /ocr2rank output (it needs at least player_names).");
      return;
    }
    const next: Draft = { ...d, lines: { ...d.lines } };
    for (const id of Object.keys(next.lines)) next.lines[id] = { ...next.lines[id], played: false };
    const unmatched: string[] = [];
    let aWins = 0;
    let bWins = 0;
    for (const line of parsed.players) {
      const pa = matchRosterName(line.name, teamA.roster);
      const pb = pa ? null : matchRosterName(line.name, teamB.roster);
      const hit = pa ?? pb;
      if (!hit) {
        unmatched.push(line.name);
        continue;
      }
      if (line.result === "W") {
        if (pa) aWins++;
        else bWins++;
      }
      const v = (n: number | null) => (n === null ? "" : String(n));
      next.lines[hit.discordId] = {
        played: true,
        kills: v(line.kills),
        deaths: v(line.deaths),
        assists: v(line.assists),
        mvps: v(line.mvps),
        score: v(line.score),
        hs: v(line.hs),
      };
    }
    if (parsed.mapName) next.mapName = parsed.mapName;
    // BO1: the round score is the match result already; BO3 maps take it from the paste.
    if (bo > 1 && parsed.winnerRounds !== null && parsed.loserRounds !== null && aWins !== bWins) {
      const aWon = aWins > bWins;
      next.roundsA = String(aWon ? parsed.winnerRounds : parsed.loserRounds);
      next.roundsB = String(aWon ? parsed.loserRounds : parsed.winnerRounds);
    }
    setD(next);
    setNote(
      unmatched.length
        ? `Filled in. Not on either roster (left out — tick the right player by hand): ${unmatched.join(", ")}.`
        : "Filled in — check the numbers and the round score, then save."
    );
  };

  const save = () =>
    onSave({
      mapNo,
      mapName: d.mapName,
      roundsA: Number(d.roundsA),
      roundsB: Number(d.roundsB),
      players: [teamA, teamB].flatMap((t) =>
        t.roster
          .filter((p) => d.lines[p.discordId]?.played)
          .map((p) => {
            const l = d.lines[p.discordId];
            return {
              teamId: t.id,
              discordId: p.discordId,
              kills: Number(l.kills || 0),
              deaths: Number(l.deaths || 0),
              assists: Number(l.assists || 0),
              mvps: Number(l.mvps || 0),
              score: Number(l.score || 0),
              hs: Number(l.hs || 0),
            };
          })
      ),
    });

  const box = "h-8 rounded-md border border-white/[0.12] bg-[#1b1b1b] px-2 text-sm text-white outline-none focus:border-[#ff5500]";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
            Paste /ocr2rank output (optional)
          </label>
          <div className="flex gap-2">
            <textarea
              rows={2}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="/rank player_names: … kills: … deaths: …   (run /ocr2rank with the screenshot in Discord)"
              className="min-w-0 flex-1 rounded-md border border-white/[0.12] bg-[#1b1b1b] px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-[#ff5500]"
            />
            <button
              type="button"
              disabled={!paste.trim()}
              onClick={fillFromPaste}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-white/15 px-3 py-2 text-xs font-black uppercase tracking-wide text-white/80 hover:text-white disabled:opacity-40"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> Fill
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Map</span>
            <input value={d.mapName} onChange={(e) => setD({ ...d, mapName: e.target.value.slice(0, 40) })} placeholder="e.g. Dust II" className={`${box} w-32`} />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Rounds</span>
            <span className="flex items-center gap-1">
              <input inputMode="numeric" aria-label={`${teamA.name} rounds`} value={d.roundsA} onChange={(e) => setD({ ...d, roundsA: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder={teamA.tag || "A"} className={`${box} w-12 text-center`} />
              <span className="text-white/40">–</span>
              <input inputMode="numeric" aria-label={`${teamB.name} rounds`} value={d.roundsB} onChange={(e) => setD({ ...d, roundsB: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder={teamB.tag || "B"} className={`${box} w-12 text-center`} />
            </span>
          </label>
        </div>
      </div>
      {note ? <p className="text-xs text-white/65">{note}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {[teamA, teamB].map((t) => (
          <div key={t.id} className="min-w-0">
            <div className="mb-1.5 text-xs font-black text-white">{t.name}</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.1em] text-white/45">
                    <th className="w-8 py-1 text-left" title="Played this map">✓</th>
                    <th className="py-1 text-left">Player</th>
                    {CELLS.map(([, label]) => (
                      <th key={label} className="w-14 py-1 text-center">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.roster.map((p) => {
                    const l = d.lines[p.discordId];
                    return (
                      <tr key={p.discordId} className={l.played ? "" : "opacity-45"}>
                        <td className="py-1">
                          <input type="checkbox" aria-label={`${p.name} played`} checked={l.played} onChange={(e) => setLine(p.discordId, { played: e.target.checked })} />
                        </td>
                        <td className="truncate py-1 pr-2 font-bold text-white">{p.name}</td>
                        {CELLS.map(([cell, label]) => (
                          <td key={cell} className="px-0.5 py-1">
                            <input
                              inputMode={cell === "hs" ? "decimal" : "numeric"}
                              aria-label={`${p.name} ${label}`}
                              disabled={!l.played}
                              value={l[cell]}
                              onChange={(e) =>
                                setLine(p.discordId, {
                                  [cell]: e.target.value.replace(cell === "hs" ? /[^\d.]/g : /\D/g, "").slice(0, cell === "score" ? 4 : 5),
                                })
                              }
                              className={`${box} w-full text-center tabular-nums`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-white/50">
          {bo > 1 ? `Best of ${bo}: save each map separately. ` : ""}League stats never change ranked stats.
        </span>
        <div className="flex gap-2">
          {saved ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm(`Delete the map ${mapNo} scoreboard?`) && onDelete()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-black uppercase tracking-wide text-white/70 hover:border-hl-red/50 hover:text-hl-red disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || d.roundsA === "" || d.roundsB === ""}
            onClick={save}
            className="find-match-btn h-9 rounded-lg px-4 text-xs font-black uppercase tracking-wide text-hl-base disabled:opacity-40"
          >
            {saved ? "Update scoreboard" : "Save scoreboard"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Match Staff: enter or fix a map's scoreboard (after a confirmed, non-forfeit result). */
export function LeagueStatsEditor({
  bo,
  teamA,
  teamB,
  maps,
  bo1Score,
  busy,
  onSave,
  onDelete,
}: {
  bo: number;
  teamA: Team;
  teamB: Team;
  maps: MapScoreboard[];
  bo1Score: [number, number] | null;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: (mapNo: number) => void;
}) {
  const [mapNo, setMapNo] = useState(() => Math.min(bo, (maps.length ? Math.max(...maps.map((m) => m.mapNo)) : 0) + 1));
  const saved = maps.find((m) => m.mapNo === mapNo) ?? null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-white">Scoreboard (league stats)</div>
        {bo > 1 ? (
          <div className="flex gap-1">
            {Array.from({ length: bo }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMapNo(n)}
                className={`h-8 rounded-md border px-3 text-xs font-black ${
                  n === mapNo ? "border-[#ff5500] bg-[#ff5500]/15 text-white" : "border-white/[0.12] text-white/60 hover:text-white"
                }`}
              >
                Map {n}
                {maps.some((m) => m.mapNo === n) ? " ✓" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {/* key: switching maps (or a save changing what's stored) starts a fresh form. */}
      <MapEditor
        key={`${mapNo}-${saved ? saved.players.map((p) => `${p.discordId}:${p.kills}:${p.score}`).join(",") + saved.roundsA + saved.roundsB : "new"}`}
        mapNo={mapNo}
        bo={bo}
        teamA={teamA}
        teamB={teamB}
        saved={saved}
        bo1Score={bo === 1 ? bo1Score : null}
        busy={busy}
        onSave={onSave}
        onDelete={() => onDelete(mapNo)}
      />
    </div>
  );
}
