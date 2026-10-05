"use client";

/**
 * Staff panel → Ranking → Rank by hand (CBL bot docs/STAFF_PANEL_PLAN.md step 8):
 * the scoreboard as a form — /rank manual, or /rank draw when it's a draw.
 * Rows can be filled from a live match's lobby or read from an end-of-match
 * screenshot (the bot's /rank screenshot reader); staff check and fix them.
 */
import { useRef, useState } from "react";
import { ClipboardList, ImageUp, Plus, Users, X } from "lucide-react";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import { CardTitle, ConfirmButton, StaffCard, SubHeading, fieldLabel, input, primary, secondary } from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import { MAP_NAMES } from "@/data/maps";
import { QUEUE_REGIONS } from "@/lib/regions";
import type { StaffJob } from "@/lib/staff-jobs";
import type { LiveMatchOption } from "@/lib/staff-ranking";

type Settled = (job: StaffJob) => void;
type Team = "1" | "2";
type Stat = "k" | "d" | "a" | "dmg" | "hs" | "mvp" | "rp";
type Row = { name: string; team: Team } & Record<Stat, string>;

const NO_MATCH = "none";
const MODES: [string, string][] = [
  ["", "Auto (from the match / player count)"],
  ["5v5", "5v5"],
  ["pro", "Pro 5v5"],
  ["3v3", "3v3"],
  ["2v2", "2v2"],
  ["1v1", "1v1"],
];
/** Form column → the command's option. HS% and rounds played are /rank manual only. */
const COLUMNS: { stat: Stat; label: string; option: string; float?: boolean; manualOnly?: boolean; hint?: string }[] = [
  { stat: "k", label: "K", option: "kills" },
  { stat: "d", label: "D", option: "deaths" },
  { stat: "a", label: "A", option: "assists" },
  { stat: "dmg", label: "DMG", option: "damage" },
  { stat: "hs", label: "HS%", option: "hs", float: true, manualOnly: true },
  { stat: "mvp", label: "MVP", option: "mvps" },
  { stat: "rp", label: "RP", option: "rounds_played", manualOnly: true, hint: "Rounds played (empty = the whole match)" },
];

const emptyRow = (team: Team): Row => ({ name: "", team, k: "", d: "", a: "", dmg: "", hs: "", mvp: "", rp: "" });
const freshRows = (perTeam = 5): Row[] => [
  ...Array.from({ length: perTeam }, () => emptyRow("1")),
  ...Array.from({ length: perTeam }, () => emptyRow("2")),
];
const isPlaceholder = (v: string | undefined) => !v || v.trim().startsWith("<");

/** The screenshot, shrunk to at most 1920 px as a JPEG so the upload stays small. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

interface ScreenshotDraft {
  command: "rank manual" | "rank draw";
  fields: Record<string, string>;
  teams: number[] | null;
  notes: string[];
}

export function ManualRank({ live, onSettled }: { live: LiveMatchOption[] | null; onSettled: Settled }) {
  const [rows, setRows] = useState<Row[]>(() => freshRows());
  const [match, setMatch] = useState("");
  const [result, setResult] = useState<"1" | "2" | "draw">("1");
  const [r1, setR1] = useState("");
  const [r2, setR2] = useState("");
  const [map, setMap] = useState("");
  const [region, setRegion] = useState("");
  const [mode, setMode] = useState("");
  const [playTime, setPlayTime] = useState("");
  const [subs, setSubs] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const reader = useStaffJob();
  const rank = useStaffJob((job) => {
    onSettled(job);
    if (job.status !== "done") return;
    setRows(freshRows());
    setR1("");
    setR2("");
    setSubs("");
    setPlayTime("");
    setNotes([]);
  });
  const draw = result === "draw";
  const channelArg = match && match !== NO_MATCH ? match : undefined;
  const liveSelected = live?.find((m) => m.id === match) ?? null;

  const setCell = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const fillFromMatch = () => {
    if (!liveSelected) return;
    const next: Row[] = [
      ...liveSelected.teams.team1.map((name) => ({ ...emptyRow("1"), name })),
      ...liveSelected.teams.team2.map((name) => ({ ...emptyRow("2"), name })),
    ];
    if (next.length) setRows(next);
    if (liveSelected.map) setMap(liveSelected.map);
    if (liveSelected.region) setRegion(liveSelected.region);
  };

  const applyDraft = (d: ScreenshotDraft) => {
    const f = d.fields;
    const names = (f.player_names ?? "").split(",").map((n) => n.trim());
    const results = isPlaceholder(f.match_results) ? [] : (f.match_results ?? "").split(",").map((r) => r.trim().toUpperCase());
    const teamOf = (i: number): Team => {
      const t = d.teams?.[i] ?? (f.teams ? Number(f.teams.split(",")[i]) : results[i] === "L" ? 2 : 1);
      return t === 2 ? "2" : "1";
    };
    const col = (key: string) => (isPlaceholder(f[key]) ? [] : (f[key] ?? "").split(","));
    const cols = { k: col("kills"), d: col("deaths"), a: col("assists"), dmg: col("damage"), hs: col("hs"), mvp: col("mvps") };
    setRows(
      names.map((name, i) => ({
        ...emptyRow(teamOf(i)),
        name,
        k: cols.k[i] ?? "",
        d: cols.d[i] ?? "",
        a: cols.a[i] ?? "",
        dmg: cols.dmg[i] ?? "",
        hs: cols.hs[i] ?? "",
        mvp: cols.mvp[i] ?? "",
      }))
    );
    if (d.command === "rank draw") {
      setResult("draw");
      const [a, b] = (f.rounds ?? "").split(",");
      setR1(a ?? "");
      setR2(b ?? "");
    } else {
      const winnerIndex = results.indexOf("W");
      const winner: Team = winnerIndex >= 0 ? teamOf(winnerIndex) : "1";
      setResult(winner);
      if (!isPlaceholder(f.points)) {
        const [won, lost] = (f.points ?? "").split(",");
        setR1(winner === "1" ? won : lost);
        setR2(winner === "1" ? lost : won);
      }
    }
    if (!isPlaceholder(f.map_name)) setMap(f.map_name);
    if (!isPlaceholder(f.region)) setRegion(f.region);
    if (!isPlaceholder(f.play_time)) setPlayTime(f.play_time);
    if (!isPlaceholder(f.subs)) setSubs(f.subs);
    setNotes(d.notes);
  };

  const readScreenshot = async (file: File) => {
    let image: string;
    try {
      image = await shrink(file);
    } catch {
      setNotes(["⚠️ That file couldn't be opened as an image."]);
      return;
    }
    const job = await reader.run("rank_screenshot", { image, image_type: "image/jpeg", channel_id: channelArg });
    const draft = job?.status === "done" ? (job.result?.data as ScreenshotDraft | undefined) : undefined;
    if (draft) applyDraft(draft);
  };

  // --- what gets sent, and why it can't be yet ---
  const named = rows.filter((r) => r.name.trim());
  const problems: string[] = [];
  if (!match) problems.push("Pick the live match, or “not from a live match”.");
  if (named.length < 2) problems.push("Enter at least 2 players.");
  if (!named.some((r) => r.team === "1") || !named.some((r) => r.team === "2")) problems.push("Both teams need players.");
  const n1 = Number(r1);
  const n2 = Number(r2);
  if (r1 === "" || r2 === "" || !Number.isInteger(n1) || !Number.isInteger(n2)) problems.push("Enter both teams' rounds.");
  else if (draw && n1 !== n2) problems.push("A draw has the same rounds for both teams.");
  else if (!draw && (result === "1" ? n1 <= n2 : n2 <= n1)) problems.push("The winning team needs more rounds.");
  const args: Record<string, unknown> = { player_names: named.map((r) => r.name.trim()).join(","), channel_id: channelArg };
  for (const c of COLUMNS) {
    if (draw && c.manualOnly) continue;
    const values = named.map((r) => r[c.stat].trim());
    const filled = values.filter(Boolean).length;
    if (!filled) {
      if (c.stat === "k") problems.push("Enter everyone's kills.");
      continue;
    }
    if (filled !== values.length) problems.push(`${c.label}: fill it for every player or for none.`);
    else if (values.some((v) => !(c.float ? /^\d+(\.\d+)?$/ : /^\d+$/).test(v))) problems.push(`${c.label}: numbers only.`);
    else args[c.option] = values.join(",");
  }
  if (mode) args.mode = mode;
  if (draw) {
    args.teams = named.map((r) => r.team).join(",");
    args.rounds = `${n1},${n2}`;
  } else {
    args.match_results = named.map((r) => (r.team === result ? "W" : "L")).join(",");
    args.points = `${Math.max(n1, n2)},${Math.min(n1, n2)}`;
    if (map) args.map_name = map;
    if (region) args.region = region;
    if (playTime.trim()) args.play_time = playTime.trim();
    if (subs.trim()) args.subs = subs.trim();
  }
  const busy = rank.busy || reader.busy;

  return (
    <StaffCard>
      <CardTitle
        icon={<ClipboardList className="h-4 w-4 text-hl-gold" />}
        title="Rank by hand"
        hint="The scoreboard as a form: /rank manual, or /rank draw for a draw. Fill it from the live match or a screenshot, then check it."
      />
      <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <select value={match} onChange={(e) => setMatch(e.target.value)} aria-label="Live match" className={input}>
          <option value="">{live ? "Pick the live match…" : "Loading matches…"}</option>
          {(live ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {[m.matchNumber ? `Match #${m.matchNumber}` : "Match", m.map, m.region].filter(Boolean).join(" · ")}
            </option>
          ))}
          <option value={NO_MATCH}>Not from a live match</option>
        </select>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondary} disabled={!liveSelected || busy} onClick={fillFromMatch}>
            <Users className="h-3.5 w-3.5" /> Fill from match
          </button>
          <button type="button" className={secondary} disabled={busy} onClick={() => fileRef.current?.click()}>
            <ImageUp className="h-3.5 w-3.5" /> Read a screenshot
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readScreenshot(file);
            }}
          />
        </div>
      </div>
      <div className="mt-2">
        <StaffJobOutcome state={reader.state.phase === "finished" && reader.state.job.status === "done" ? { phase: "idle" } : reader.state} />
      </div>
      {notes.length ? (
        <ul className="mt-2 space-y-0.5 text-xs">
          {notes.map((n, i) => (
            <li key={i} className={n.includes("⚠") ? "text-hl-gold" : "text-hl-muted"}>
              • {n}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-hl-border">
        <table className="w-full min-w-[40rem] text-xs">
          <thead className="bg-hl-base/70 text-[0.6875rem] text-hl-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold">Player</th>
              <th className="px-1 py-1.5 font-bold">Team</th>
              {COLUMNS.filter((c) => !(draw && c.manualOnly)).map((c) => (
                <th key={c.stat} className="px-1 py-1.5 font-bold" title={c.hint}>
                  {c.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hl-border">
            {rows.map((row, i) => (
              <tr key={i} className={row.team === "1" ? "" : "bg-white/[0.02]"}>
                <td className="px-1.5 py-1">
                  <input
                    value={row.name}
                    onChange={(e) => setCell(i, { name: e.target.value.slice(0, 32) })}
                    placeholder="Player name"
                    aria-label={`Row ${i + 1} player`}
                    className="h-8 w-full min-w-[8rem] rounded-md border border-hl-border bg-hl-base px-2 text-xs text-white"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <select
                    value={row.team}
                    onChange={(e) => setCell(i, { team: e.target.value as Team })}
                    aria-label={`Row ${i + 1} team`}
                    className="h-8 rounded-md border border-hl-border bg-hl-base px-1 text-xs text-white [color-scheme:dark]"
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </td>
                {COLUMNS.filter((c) => !(draw && c.manualOnly)).map((c) => (
                  <td key={c.stat} className="px-1 py-1">
                    <input
                      value={row[c.stat]}
                      onChange={(e) => setCell(i, { [c.stat]: e.target.value.replace(c.float ? /[^\d.]/g : /\D/g, "").slice(0, 6) })}
                      inputMode={c.float ? "decimal" : "numeric"}
                      aria-label={`Row ${i + 1} ${c.label}`}
                      className="h-8 w-14 rounded-md border border-hl-border bg-hl-base px-1.5 text-right text-xs text-white"
                    />
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove row ${i + 1}`}
                    className="rounded p-1 text-hl-muted hover:text-hl-red"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => setRows((prev) => (prev.length >= 12 ? prev : [...prev, emptyRow("2")]))}
        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-hl-muted hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" /> Add a row (a sub, or more players)
      </button>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={fieldLabel}>Result</span>
          <select value={result} onChange={(e) => setResult(e.target.value as "1" | "2" | "draw")} className={`${input} w-full`}>
            <option value="1">Team 1 won</option>
            <option value="2">Team 2 won</option>
            <option value="draw">Draw</option>
          </select>
        </label>
        <div>
          <span className={fieldLabel}>Rounds (team 1 – team 2)</span>
          <div className="flex items-center gap-1.5">
            <input value={r1} onChange={(e) => setR1(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" aria-label="Team 1 rounds" className={`${input} w-full`} />
            <span className="text-hl-muted">–</span>
            <input value={r2} onChange={(e) => setR2(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" aria-label="Team 2 rounds" className={`${input} w-full`} />
          </div>
        </div>
        <label className="block">
          <span className={fieldLabel}>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${input} w-full`}>
            {MODES.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        {!draw ? (
          <label className="block">
            <span className={fieldLabel}>Map</span>
            <select value={map} onChange={(e) => setMap(e.target.value)} className={`${input} w-full`}>
              <option value="">—</option>
              {[...new Set([...MAP_NAMES, ...(map ? [map] : [])])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!draw ? (
          <>
            <label className="block">
              <span className={fieldLabel}>Region</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={`${input} w-full`}>
                <option value="">—</option>
                {[...new Set([...QUEUE_REGIONS.map((r) => r.id as string), ...(region ? [region] : [])])].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Play time (optional)</span>
              <input value={playTime} onChange={(e) => setPlayTime(e.target.value.slice(0, 8))} placeholder="25:00" className={`${input} w-full`} />
            </label>
            <label className="block sm:col-span-2">
              <span className={fieldLabel}>Subs the bot didn&apos;t record (optional)</span>
              <input
                value={subs}
                onChange={(e) => setSubs(e.target.value.slice(0, 200))}
                placeholder="leaver>sub@7,4"
                className={`${input} w-full font-mono`}
              />
            </label>
          </>
        ) : (
          <p className="text-xs text-hl-muted sm:col-span-2 lg:col-span-1">
            A draw is ranked with /rank draw: no map, HS% or rounds played.
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-hl-border pt-4">
        {problems.length ? (
          <ul className="mb-3 space-y-0.5 text-xs text-hl-muted">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <ConfirmButton
            className={primary}
            confirmText="Click again to rank"
            disabled={problems.length > 0 || busy}
            onConfirm={() => void rank.run(draw ? "rank_draw" : "rank_manual", args)}
          >
            {draw ? "Rank the draw" : "Rank this match"}
          </ConfirmButton>
          <span className="text-xs text-hl-muted">
            {channelArg ? "The result is posted in the match channel." : "Applies the Elo like the command in Discord."}
          </span>
        </div>
        <div className="mt-3">
          {rank.state.phase !== "idle" ? <SubHeading>Result</SubHeading> : null}
          <StaffJobOutcome state={rank.state} />
        </div>
      </div>
    </StaffCard>
  );
}
