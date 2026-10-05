"use client";

/**
 * Staff panel → Ranking (CBL bot docs/STAFF_PANEL_PLAN.md steps 3 and 8): rank a
 * match from its Counter Blox game on playcbrm.xyz (the same preview and
 * Accept as /rank cbrm) or by hand (components/staff/manual-rank.tsx), undo a ranked match, the Elo boost and the Discord
 * rank roles. Everything runs on the bot.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Flame, History, RefreshCw, Scale, Search, ShieldCheck, Trophy, Undo2 } from "lucide-react";
import { ManualRank } from "@/components/staff/manual-rank";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import { CardTitle, ConfirmButton, StaffCard, SubHeading, input, primary, secondary } from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import { timeAgo } from "@/lib/format";
import { parseCbrmGameId } from "@/lib/staff-shared";
import type { StaffJob } from "@/lib/staff-jobs";
import type { LiveMatchOption, RecentRankedMatch, StaffRankingView } from "@/lib/staff-ranking";

type Settled = (job: StaffJob) => void;

/** cogs/cbrm_results.py preview_data(). */
interface CbrmPlayer {
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  hs: number;
  mvps: number;
  rounds: number | null;
}
interface CbrmPreview {
  game: { id: string; map: string; ct: number; t: number; url: string };
  ready: boolean;
  draw: boolean;
  notes: string[];
  teams: { team: number; side: string; rounds: number; won: boolean; players: CbrmPlayer[] }[];
  subTeams: { team: number; side: string; players: { name: string; rounds: number | null }[]; leaver: string | null; sub: string | null }[];
  totalRounds: number;
  command: string | null;
}
type Swaps = Record<string, [string | null, string | null]>;

/** "Not from a live match" in the match picker (no lobby check, no post in a match channel). */
const NO_MATCH = "none";

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → epoch ms. */
function sqliteMs(at: string): number {
  const ms = Date.parse(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

function matchLabel(m: LiveMatchOption): string {
  const parts = [m.matchNumber ? `Match #${m.matchNumber}` : "Match", m.map, m.region, m.queueMode && m.queueMode !== "standard" ? m.queueMode : null];
  return `${parts.filter(Boolean).join(" · ")} · ${timeAgo(m.createdAt)}`;
}

function Scoreboard({ team, total }: { team: CbrmPreview["teams"][number]; total: number }) {
  return (
    <div className="min-w-0">
      <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-black header-caps ${team.won ? "text-hl-green" : "text-hl-muted"}`}>
        {team.side} · {team.rounds}
        {team.won ? <Trophy className="h-3.5 w-3.5" /> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-hl-border">
        <table className="w-full min-w-[20rem] text-xs">
          <thead className="bg-hl-base/70 text-[0.6875rem] text-hl-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold">Player</th>
              {["K/D/A", "DMG", "HS%", "MVP", "RP"].map((h) => (
                <th key={h} className="px-1.5 py-1.5 text-right font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hl-border">
            {team.players.map((p) => (
              <tr key={p.name} className="text-white">
                <td className="max-w-[9rem] truncate px-2 py-1.5 font-semibold">{p.name}</td>
                <td className="whitespace-nowrap px-1.5 py-1.5 text-right">
                  {p.kills}/{p.deaths}/{p.assists}
                </td>
                <td className="px-1.5 py-1.5 text-right">{p.damage}</td>
                <td className="px-1.5 py-1.5 text-right">{p.hs}</td>
                <td className="px-1.5 py-1.5 text-right">{p.mvps}</td>
                <td className={`px-1.5 py-1.5 text-right ${p.rounds != null && p.rounds < total ? "text-hl-gold" : "text-hl-muted"}`}>
                  {p.rounds ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CbrmCard({
  live,
  onReload,
  onSettled,
}: {
  live: LiveMatchOption[] | null;
  onReload: () => void;
  onSettled: Settled;
}) {
  const [gameInput, setGameInput] = useState("");
  const [match, setMatch] = useState("");
  const [looked, setLooked] = useState<{ gameId: string; match: string } | null>(null);
  const preview = useStaffJob();
  const accept = useStaffJob(onSettled);
  const gameId = parseCbrmGameId(gameInput);
  const channelArg = (m: string) => (m && m !== NO_MATCH ? m : undefined);

  const data =
    preview.state.phase === "finished" && preview.state.job.status === "done"
      ? ((preview.state.job.result?.data as CbrmPreview | undefined) ?? null)
      : null;
  const stale = !looked || looked.gameId !== gameId || looked.match !== match;
  const acceptDone = accept.state.phase === "finished" && accept.state.job.status === "done";

  const lookUp = (swaps?: Swaps) => {
    if (!gameId || !match) return;
    setLooked({ gameId, match });
    if (!swaps) accept.reset();
    void preview.run("cbrm_preview", { game_id: gameId, channel_id: channelArg(match), ...(swaps ? { swaps } : {}) });
  };

  const currentSwaps = (d: CbrmPreview): Swaps =>
    Object.fromEntries(d.subTeams.map((t) => [String(t.team), [t.leaver, t.sub]])) as Swaps;

  const pick = (team: number, role: 0 | 1, name: string) => {
    if (!data) return;
    const swaps = currentSwaps(data);
    const pair = [...(swaps[String(team)] ?? [null, null])] as [string | null, string | null];
    pair[role] = name || null;
    lookUp({ ...swaps, [String(team)]: pair });
  };

  const liveSelected = live?.find((m) => m.id === match) ?? null;

  return (
    <StaffCard>
      <CardTitle
        icon={<Search className="h-4 w-4 text-hl-gold" />}
        title="Rank a match from CBRM"
        hint="The same as /rank cbrm: paste the game's ID (or its link) from playcbrm.xyz/matches, check the scoreboard, then accept."
        right={
          <button
            type="button"
            onClick={onReload}
            className="rounded-md p-1.5 text-hl-muted hover:bg-hl-panel-light hover:text-white"
            aria-label="Refresh live matches"
            title="Refresh live matches"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      />
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        <input
          value={gameInput}
          onChange={(e) => setGameInput(e.target.value.slice(0, 200))}
          placeholder="Game ID, e.g. 1Woq74ZG"
          aria-label="CBRM game ID"
          className={`${input} font-mono`}
        />
        <select value={match} onChange={(e) => setMatch(e.target.value)} aria-label="Live match" className={input}>
          <option value="">{live ? (live.length ? "Pick the live match…" : "No live matches — pick below") : "Loading matches…"}</option>
          {(live ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {matchLabel(m)}
            </option>
          ))}
          <option value={NO_MATCH}>Not from a live match (no lobby check)</option>
        </select>
        <button type="button" className={primary} disabled={!gameId || !match || preview.busy} onClick={() => lookUp()}>
          Look up
        </button>
      </div>
      {gameInput.trim() && !gameId ? <p className="mt-1.5 text-xs text-hl-red">That isn&apos;t a game ID or playcbrm.xyz link.</p> : null}
      {liveSelected ? (
        <p className="mt-1.5 truncate text-xs text-hl-muted">
          {liveSelected.teams.team1.join(", ")} <span className="text-hl-gold">vs</span> {liveSelected.teams.team2.join(", ")}
        </p>
      ) : match === NO_MATCH ? (
        <p className="mt-1.5 text-xs text-hl-gold">
          Without a live match the bot can&apos;t check the players against a lobby, find recorded subs, or tell a Pro match
          apart. Pick the match when it&apos;s still listed.
        </p>
      ) : null}

      <div className="mt-4">
        {data ? null : <StaffJobOutcome state={preview.state} />}
        {data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-sm font-black text-white">
                {data.game.map} · CT {data.game.ct} – {data.game.t} T
              </h3>
              <span
                className={`rounded px-1.5 py-0.5 text-[0.6875rem] font-bold ${
                  data.ready ? "bg-hl-green/10 text-hl-green" : "bg-hl-gold/10 text-hl-gold"
                }`}
              >
                {data.ready ? (data.draw ? "Ready · draw" : "Ready") : data.subTeams.length ? "Pick the sub" : "Needs a fix"}
              </span>
              <a
                href={data.game.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-hl-muted hover:text-white"
              >
                Game {data.game.id} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {data.teams.map((t) => (
                <Scoreboard key={t.team} team={t} total={data.totalRounds} />
              ))}
            </div>
            <p className="text-[0.6875rem] text-hl-muted">RP = rounds played (of {data.totalRounds}); fewer in gold.</p>

            {data.subTeams.map((t) => (
              <div key={t.team} className="rounded-lg border border-hl-gold/40 bg-hl-gold/5 p-3">
                <SubHeading>{t.side}: one player too many — who left, who subbed in?</SubHeading>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([0, 1] as const).map((role) => (
                    <select
                      key={role}
                      value={(role === 0 ? t.leaver : t.sub) ?? ""}
                      disabled={preview.busy || accept.busy || acceptDone}
                      onChange={(e) => pick(t.team, role, e.target.value)}
                      aria-label={role === 0 ? "Who left" : "Who subbed in"}
                      className={input}
                    >
                      <option value="">{role === 0 ? "Who left?" : "Who subbed in?"}</option>
                      {t.players.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} · {p.rounds ?? "?"}/{data.totalRounds} rounds
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              </div>
            ))}

            {data.notes.length ? (
              <ul className="space-y-1 text-xs">
                {data.notes.map((n, i) => (
                  <li key={i} className={n.includes("⚠") ? "text-hl-gold" : "text-hl-muted"}>
                    • {n}
                  </li>
                ))}
              </ul>
            ) : null}

            {data.command ? (
              <div>
                <SubHeading>Needs a human first</SubHeading>
                <p className="mb-2 text-xs text-hl-muted">
                  Enter the scoreboard in Rank by hand below (it can read the end screen), or fix this /rank manual
                  command and run it in Discord.
                </p>
                <div className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-hl-border bg-black/40 p-2 text-[0.75rem] text-[#d4d4d4]">
                    {data.command}
                  </pre>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => void navigator.clipboard?.writeText(data.command ?? "").catch(() => undefined)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 border-t border-hl-border pt-4">
                <button
                  type="button"
                  className={primary}
                  disabled={!data.ready || stale || accept.busy || acceptDone || preview.busy}
                  onClick={() =>
                    looked &&
                    void accept.run("cbrm_accept", {
                      game_id: looked.gameId,
                      channel_id: channelArg(looked.match),
                      ...(data.subTeams.length ? { swaps: currentSwaps(data) } : {}),
                    })
                  }
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> {data.draw ? "Accept the draw" : "Accept and rank"}
                </button>
                <span className="text-xs text-hl-muted">
                  {stale
                    ? "The game or match changed: look it up again first."
                    : looked?.match && looked.match !== NO_MATCH
                      ? "Applies the Elo like Accept in Discord, and posts the result in the match channel."
                      : "Applies the Elo like Accept in Discord."}
                </span>
              </div>
            )}
            <StaffJobOutcome state={accept.state} />
          </div>
        ) : null}
      </div>
    </StaffCard>
  );
}

function RecentRanked({ recent, onSettled }: { recent: RecentRankedMatch[] | null; onSettled: Settled }) {
  const undo = useStaffJob(onSettled);
  return (
    <StaffCard>
      <CardTitle
        icon={<History className="h-4 w-4 text-hl-gold" />}
        title="Recent ranked matches"
        hint="Undo puts Elo, ranks and stats back. Only the latest match is restored exactly; older ones have their changes reversed."
      />
      <div className="mb-3">
        <StaffJobOutcome state={undo.state} />
      </div>
      {!recent ? (
        <p className="text-sm text-hl-muted">Loading…</p>
      ) : !recent.length ? (
        <p className="text-sm text-hl-muted">No ranked matches yet.</p>
      ) : (
        <ul className="divide-y divide-hl-border">
          {recent.map((m) => (
            <li key={m.matchId} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-mono text-xs text-hl-muted">#{m.matchId}</span>
                  <span className="font-semibold text-white">{m.map ?? "Unknown map"}</span>
                  {m.score ? <span className="text-white">{m.score.replace(",", "–")}</span> : null}
                  {m.mode && m.mode !== "5v5" ? <span className="text-xs text-hl-muted">{m.mode}</span> : null}
                  {m.test ? <span className="rounded bg-white/5 px-1 text-[0.6875rem] text-hl-muted">test</span> : null}
                  {m.cbrmGameId ? (
                    <a
                      href={`https://www.playcbrm.xyz/matches/${encodeURIComponent(m.cbrmGameId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-xs text-hl-muted hover:text-white"
                    >
                      CBRM <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
                <div className="truncate text-xs">
                  <span className="text-hl-green">{m.winners.join(", ")}</span>
                  {m.losers.length ? <span className="text-hl-muted"> vs </span> : null}
                  <span className="text-hl-red/90">{m.losers.join(", ")}</span>
                  {m.others.length ? <span className="text-hl-muted"> {m.others.join(", ")}</span> : null}
                </div>
                <div className="text-[0.6875rem] text-hl-muted">
                  {m.at ? timeAgo(sqliteMs(m.at)) : ""}
                  {m.by ? ` · by ${m.by}` : ""}
                </div>
              </div>
              <ConfirmButton
                className={secondary}
                confirmText="Click again"
                disabled={undo.busy}
                onConfirm={() => void undo.run("rank_undo", { match_id: m.matchId })}
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </StaffCard>
  );
}

function BoostCard({ boost, onSettled }: { boost: number | null; onSettled: Settled }) {
  const job = useStaffJob(onSettled);
  return (
    <StaffCard>
      <CardTitle
        icon={<Flame className="h-4 w-4 text-hl-gold" />}
        title="Elo boost"
        hint="Wins give 2x or 3x Elo; losses stay normal. Same as /elo boost."
      />
      <div className="flex h-9 w-fit overflow-hidden rounded-lg border border-hl-border">
        {[
          [1, "Off"],
          [2, "2x"],
          [3, "3x"],
        ].map(([value, text]) => (
          <button
            key={value}
            type="button"
            aria-pressed={boost === value}
            disabled={job.busy || boost === null || boost === value}
            onClick={() => void job.run("elo_boost", { multiplier: value })}
            className={`px-4 text-xs font-black header-caps disabled:cursor-default ${
              boost === value
                ? value === 1
                  ? "bg-hl-panel-light text-white"
                  : "bg-hl-gold/20 text-hl-gold"
                : "text-hl-muted hover:text-white"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-hl-muted">
        {boost === null ? "Loading…" : boost === 1 ? "No boost running." : `A ${boost}x boost is running.`}
      </p>
      <div className="mt-2">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

/** Votes a tie needs in each overtime (the bot's /match overtimevote). */
const OVERTIME_VOTES: Record<number, number> = { 1: 6, 2: 5, 3: 3 };

function OvertimeVoteStarter({ live, onSettled }: { live: LiveMatchOption[] | null; onSettled: Settled }) {
  const [match, setMatch] = useState("");
  const [overtime, setOvertime] = useState(1);
  const job = useStaffJob(onSettled);
  const picked = live?.find((m) => m.id === match) ?? null;
  return (
    <StaffCard>
      <CardTitle
        icon={<Scale className="h-4 w-4 text-hl-gold" />}
        title="Overtime tie vote"
        hint="Posts the vote in the match channel; players vote there or in the website match room. A tie means: rank it as a draw. Same as /match overtimevote."
      />
      <div className="space-y-2">
        <select value={match} onChange={(e) => setMatch(e.target.value)} aria-label="Match for the vote" className={`${input} w-full`}>
          <option value="">{live ? (live.length ? "Pick the live match…" : "No live matches") : "Loading matches…"}</option>
          {(live ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {matchLabel(m)}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          <select value={overtime} onChange={(e) => setOvertime(Number(e.target.value))} aria-label="Overtime" className={input}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                Overtime {n} · {OVERTIME_VOTES[n] ?? 1} vote{(OVERTIME_VOTES[n] ?? 1) === 1 ? "" : "s"} to tie
              </option>
            ))}
          </select>
          <button
            type="button"
            className={secondary}
            disabled={!picked || job.busy}
            onClick={() =>
              picked &&
              void job.run("overtime_vote", {
                channel_id: picked.id,
                overtime,
                match: picked.matchNumber ? `match #${picked.matchNumber}` : "",
              })
            }
          >
            Start the vote
          </button>
        </div>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
    </StaffCard>
  );
}

function RolesCard({ onSettled }: { onSettled: Settled }) {
  const top10 = useStaffJob(onSettled);
  const sync = useStaffJob(onSettled);
  return (
    <StaffCard>
      <CardTitle icon={<ShieldCheck className="h-4 w-4 text-hl-gold" />} title="Discord roles" />
      <SubHeading>Top 10 role</SubHeading>
      <p className="mb-2 text-xs text-hl-muted">Gives the role to the 10 players with the most Elo. Same as /roles top10.</p>
      <button type="button" className={secondary} disabled={top10.busy} onClick={() => void top10.run("roles_top10", {})}>
        Refresh Top 10
      </button>
      <div className="mt-2">
        <StaffJobOutcome state={top10.state} />
      </div>
      <div className="mt-5 border-t border-hl-border pt-4">
        <SubHeading>All rank roles</SubHeading>
        <p className="mb-2 text-xs text-hl-muted">
          Fixes everyone&apos;s rank and Top 10 roles to match their Elo. Goes through every member, so it can take a few
          minutes. Same as /roles sync.
        </p>
        <ConfirmButton className={secondary} confirmText="Click again to sync" disabled={sync.busy} onConfirm={() => void sync.run("roles_sync", {})}>
          Sync all roles
        </ConfirmButton>
        <div className="mt-2">
          <StaffJobOutcome state={sync.state} />
        </div>
      </div>
    </StaffCard>
  );
}

export function RankingTab({ onSettled }: { onSettled: () => void }) {
  const [view, setView] = useState<StaffRankingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/ranking", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as StaffRankingView & { error?: string };
        if (!alive) return;
        if (res.ok) {
          setView(json);
          setError(null);
        } else {
          setError(json.error || "Couldn't load the ranking tab.");
        }
      })
      .catch(() => alive && setError("Couldn't load the ranking tab."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const settled = useCallback(() => {
    onSettled();
    refresh();
  }, [onSettled, refresh]);

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <CbrmCard live={view?.liveMatches ?? null} onReload={refresh} onSettled={settled} />
          <ManualRank live={view?.liveMatches ?? null} onSettled={settled} />
          <RecentRanked recent={view?.recent ?? null} onSettled={settled} />
        </div>
        <div className="space-y-5">
          <BoostCard boost={view?.boost ?? null} onSettled={settled} />
          <OvertimeVoteStarter live={view?.liveMatches ?? null} onSettled={settled} />
          <RolesCard onSettled={settled} />
        </div>
      </div>
    </div>
  );
}
