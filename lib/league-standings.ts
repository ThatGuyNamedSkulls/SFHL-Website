/**
 * Standings tab (docs/LEAGUE_UI_PLAN.md step 4): the ESEA-style stage stepper
 * (Regular season → Playoffs → Final results) and small table helpers.
 * Pure — no DB, so it only imports types.
 */
import type { MatchStatus, PlayoffRound, SeasonStatus } from "@/lib/league";

const WEEK_MS = 7 * 86_400_000;
/** Same as PLAYOFF_TEAMS in lib/league-playoffs.ts (that file needs the DB). */
export const PLAYOFF_LINE = 4;

export type StageKey = "regular" | "playoffs" | "final";
export const STAGE_KEYS: StageKey[] = ["regular", "playoffs", "final"];

/**
 * upcoming: not started (`at` = planned start) · live: being played (`at` = planned end)
 * · done: over (`at` = when it ended, if known) · none: this division skips it.
 */
export type StageState = "upcoming" | "live" | "done" | "none";

export interface Stage {
  key: StageKey;
  label: string;
  state: StageState;
  at: number | null;
}

export interface StageInput {
  season: { status: SeasonStatus; startDate: number | null; weeks: number };
  /** The division's playoff matches (empty before the playoffs, or when it has none). */
  playoffs: { round: PlayoffRound | null; status: MatchStatus }[];
  /** How many teams got a final place (set when the season ends). */
  placed: number;
  /** league_events kind → first time it happened (seasonEventTimes). */
  events: Partial<Record<string, number>>;
}

function over(status: MatchStatus): boolean {
  return status === "final" || status === "forfeit";
}

export function standingsStages({ season, playoffs, placed, events }: StageInput): Stage[] {
  const s = season.status;
  const regularEnd = season.startDate ? season.startDate + season.weeks * WEEK_MS : null;
  const seasonEnd = season.startDate ? season.startDate + (season.weeks + 2) * WEEK_MS : null;
  const pastRegular = s === "playoffs" || s === "finished";

  let regular: Stage;
  if (pastRegular) regular = { key: "regular", label: "Regular season", state: "done", at: events.playoffs_started ?? regularEnd };
  else if (s === "regular") regular = { key: "regular", label: "Regular season", state: "live", at: regularEnd };
  else regular = { key: "regular", label: "Regular season", state: "upcoming", at: season.startDate };

  let po: Stage;
  const finals = playoffs.filter((m) => m.round === "final" || m.round === "third");
  if (pastRegular && playoffs.length === 0) po = { key: "playoffs", label: "Playoffs", state: "none", at: null };
  else if (s === "finished" || (finals.length === 2 && finals.every((m) => over(m.status))))
    po = { key: "playoffs", label: "Playoffs", state: "done", at: events.season_finished ?? null };
  else if (s === "playoffs") po = { key: "playoffs", label: "Playoffs", state: "live", at: seasonEnd };
  else po = { key: "playoffs", label: "Playoffs", state: "upcoming", at: regularEnd };

  const final: Stage =
    placed > 0
      ? { key: "final", label: "Final results", state: "done", at: events.season_finished ?? null }
      : { key: "final", label: "Final results", state: "upcoming", at: s === "cancelled" ? null : seasonEnd };

  return [regular, po, final];
}

/** The stage the tab opens on: the one in progress, or the last one reached. */
export function defaultStage(stages: Stage[]): StageKey {
  const final = stages.find((x) => x.key === "final")!;
  if (final.state === "done") return "final";
  const po = stages.find((x) => x.key === "playoffs")!;
  if (po.state === "live" || po.state === "done") return "playoffs";
  return "regular";
}

export function parseStage(raw: unknown): StageKey | null {
  return typeof raw === "string" && (STAGE_KEYS as string[]).includes(raw) ? (raw as StageKey) : null;
}

/** "3d", "5h", "20m" between now and `ts` (either direction), for "ends in 3d". */
export function shortSpan(ts: number, now = Date.now()): string {
  const abs = Math.abs(ts - now);
  const [size, unit] = abs >= 86_400_000 ? [86_400_000, "d"] : abs >= 3_600_000 ? [3_600_000, "h"] : [60_000, "m"];
  return `${Math.max(1, Math.round(abs / size))}${unit}`;
}

/** What the stepper says under a stage's name, e.g. "Ends in 3d", "Finished". */
export function stageNote(stage: Stage, now = Date.now()): string {
  switch (stage.state) {
    case "none":
      return "No playoffs";
    case "done":
      return stage.key === "final" ? "All placed" : "Finished";
    case "live":
      if (!stage.at) return "In progress";
      return stage.at > now ? `Ends in ${shortSpan(stage.at, now)}` : "Wrapping up";
    case "upcoming":
      if (!stage.at) return "Not started";
      return stage.at > now ? `Starts in ${shortSpan(stage.at, now)}` : "Starting soon";
  }
}

/** Teams level on points with a neighbour (their order came from the tiebreaks). */
export function tiebrokenTeams(rows: { teamId: string; points: number; played: number }[]): Set<string> {
  const out = new Set<string>();
  rows.forEach((r, i) => {
    if (!r.played) return;
    const prev = rows[i - 1];
    const next = rows[i + 1];
    if ((prev && prev.points === r.points && prev.played) || (next && next.points === r.points && next.played)) {
      out.add(r.teamId);
    }
  });
  return out;
}
