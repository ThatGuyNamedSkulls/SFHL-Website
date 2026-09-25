/**
 * Standings tab (docs/LEAGUE_UI_PLAN.md step 4): the ESEA-style stage stepper
 * (Regular season → Playoffs → Final results) and small table helpers; league
 * v2 (docs/LEAGUE_V2_PLAN.md C2/C3): each stage's outcome cards, the
 * promotion/relegation zones of the table and the conference groups.
 * Pure — no DB, so it only imports types and the pure Swiss rules.
 */
import type { MatchStatus, PlayoffRound, SeasonStatus } from "@/lib/league";
import { movesCount, promotionTarget, relegationTarget } from "@/lib/league-swiss";

const WEEK_MS = 7 * 86_400_000;
/** Same as PLAYOFF_TEAMS in lib/league-playoffs.ts (that file needs the DB). */
export const PLAYOFF_LINE = 4;

/** Same as DIVISION_NAMES in lib/league.ts (that file needs the DB). */
export const LEVEL_NAMES: Record<string, string> = {
  pro: "Pro",
  advanced: "Advanced",
  main: "Main",
  intermediate: "Intermediate",
  entry: "Entry",
  open10: "Open 10",
  open89: "Open 8-9",
  open57: "Open 5-7",
  open14: "Open 1-4",
};

const levelName = (code: string) => LEVEL_NAMES[code] ?? code;

/** "Up to Main" → "up to Main" (inside a sentence). */
export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "1st–4th", or "4th" when it's one place. */
export function placeRange(from: number, to: number): string {
  return from === to ? ordinal(from) : `${ordinal(from)}–${ordinal(to)}`;
}

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

// --- promotion / relegation (league v2) ---------------------------------------------------------

/** What a division's season end does, from its code ("main", merged "pro+advanced") and size. */
export interface DivisionMoves {
  /** The levels playing in it. */
  levels: string[];
  /** How many of the conference go up / down (0 = nobody). */
  up: number;
  down: number;
  /** [own level, where it goes] for each level that moves. */
  upTo: [string, string][];
  downTo: [string, string][];
}

export const NO_MOVES: DivisionMoves = { levels: [], up: 0, down: 0, upTo: [], downTo: [] };

/** Same counts as seasonMoves (lib/league-swiss.ts): each team moves by its own level. */
export function divisionMoves(code: string | null, teamCount: number): DivisionMoves {
  if (!code || teamCount < 1) return NO_MOVES;
  const levels = code.split("+");
  const k = movesCount(teamCount);
  const upTo: [string, string][] = [];
  const downTo: [string, string][] = [];
  for (const level of levels) {
    const up = promotionTarget(level);
    const down = relegationTarget(level);
    if (up !== null) upTo.push([level, up]);
    if (down !== null) downTo.push([level, down]);
  }
  return { levels, up: upTo.length ? k : 0, down: downTo.length ? k : 0, upTo, downTo };
}

/**
 * The moves a division's page should show: a season that ended before
 * promotion existed (nobody got a move) shows none.
 */
export function shownMoves(code: string | null, teamCount: number, places: { movement: string | null }[]): DivisionMoves {
  if (places.length && !places.some((p) => p.movement)) return NO_MOVES;
  return divisionMoves(code, teamCount);
}

/** Only some levels of a merged division move: "Advanced teams". */
function onlyNote(moves: DivisionMoves, pairs: [string, string][]): string | null {
  return pairs.length < moves.levels.length ? `${pairs.map(([from]) => levelName(from)).join(" and ")} teams` : null;
}

/** The green card / band text: "Promoted to Main status", or one level up per level. */
export function upText(moves: DivisionMoves): { title: string; short: string; note: string | null } {
  if (moves.upTo.length === 1) {
    const to = levelName(moves.upTo[0][1]);
    return { title: `Promoted to ${to} status`, short: `Up to ${to}`, note: onlyNote(moves, moves.upTo) };
  }
  return {
    title: "Promoted one level",
    short: "One level up",
    note: moves.upTo.map(([from, to]) => `${levelName(from)} → ${levelName(to)}`).join(" · "),
  };
}

/** The red card / band text: "Relegated to Entry status", or one level down per level. */
export function downText(moves: DivisionMoves): { title: string; short: string; note: string | null } {
  if (moves.downTo.length === 1) {
    const to = levelName(moves.downTo[0][1]);
    return { title: `Relegated to ${to} status`, short: `Down to ${to}`, note: onlyNote(moves, moves.downTo) };
  }
  return {
    title: "Relegated one level",
    short: "One level down",
    note: moves.downTo.map(([from, to]) => `${levelName(from)} → ${levelName(to)}`).join(" · "),
  };
}

/** How the playoffs lead to promotion: "The top 2 after the playoffs go up to Main". */
export function promotionPath(moves: DivisionMoves): string {
  const short = lowerFirst(upText(moves).short);
  if (moves.up >= PLAYOFF_LINE) return `All ${PLAYOFF_LINE} go ${short} · the playoffs decide the champion`;
  if (moves.up === 1) return `The playoff champion goes ${short}`;
  return `The top ${moves.up} after the playoffs go ${short}`;
}

/** The relegated places are the bottom of the regular season, unless the playoffs decide them (4 teams). */
function relegatedInRegular(moves: DivisionMoves, teamCount: number): boolean {
  return teamCount - moves.down >= PLAYOFF_LINE;
}

export type Zone = "promotion" | "playoffs" | "relegation" | null;

/** Row `i` (0 = 1st) of a regular-season table of `teamCount`: its coloured zone. */
export function regularZone(i: number, teamCount: number, moves: DivisionMoves): Zone {
  if (teamCount >= PLAYOFF_LINE && i < PLAYOFF_LINE) return moves.up ? "promotion" : "playoffs";
  if (moves.down && relegatedInRegular(moves, teamCount) && i >= teamCount - moves.down) return "relegation";
  return null;
}

export interface Outcome {
  kind: "playoffs" | "up" | "down" | "prize" | "info";
  tone: "green" | "red" | "orange" | "gold" | "neutral";
  title: string;
  /** Which places get it, e.g. "1st–4th". */
  places: string;
  note: string | null;
}

/** The cards above a stage (FACEIT "stage outcomes"): what each place gets. */
export function stageOutcomes(
  stage: StageKey,
  moves: DivisionMoves,
  teamCount: number,
  prizes: readonly number[]
): Outcome[] {
  const out: Outcome[] = [];
  const n = teamCount;
  const upCard = (): Outcome => {
    const t = upText(moves);
    return { kind: "up", tone: "green", title: t.title, places: placeRange(1, Math.min(moves.up, n)), note: t.note };
  };
  const downCard = (): Outcome => {
    const t = downText(moves);
    return { kind: "down", tone: "red", title: t.title, places: placeRange(Math.max(1, n - moves.down + 1), n), note: t.note };
  };
  const prizeCard = (): Outcome => ({
    kind: "prize",
    tone: "gold",
    title: `${prizes.map((p) => p.toLocaleString("en-US")).join(" · ")} HL Coins`,
    places: placeRange(1, Math.min(prizes.length, n)),
    note: "per player · the champion also gets a team title",
  });
  const still = moves.levels.length > 0 && !moves.up && !moves.down;

  if (stage === "regular") {
    if (n >= PLAYOFF_LINE) {
      let note = "Best of 3 · 1st v 4th, 2nd v 3rd";
      if (moves.up) {
        const t = upText(moves);
        note = [promotionPath(moves), t.note].filter(Boolean).join(" · ");
      }
      out.push({
        kind: "playoffs",
        tone: moves.up ? "green" : "orange",
        title: "Qualify for the playoffs",
        places: placeRange(1, PLAYOFF_LINE),
        note,
      });
    }
    if (moves.down && relegatedInRegular(moves, n)) out.push(downCard());
  } else if (stage === "playoffs") {
    if (moves.up) out.push(upCard());
    if (moves.down && !relegatedInRegular(moves, n)) out.push(downCard());
    out.push(prizeCard());
  } else {
    if (moves.up) out.push(upCard());
    if (moves.down) out.push(downCard());
    out.push(prizeCard());
  }
  if (still) {
    out.push({
      kind: "info",
      tone: "neutral",
      title: "No promotion or relegation",
      places: "Every place",
      note: `${moves.levels.map(levelName).join("/")} is placed by skill each season · played for stats and fun`,
    });
  }
  return out;
}

// --- conferences (league v2) ---------------------------------------------------------------------

export interface ConferenceGroup {
  /** "Open 10": the division name without the conference letter. */
  name: string;
  /** The shared division code ("open10"); null on seasons drawn before codes. */
  code: string | null;
  /** One entry per conference ("A", "B"…), or a single entry with letter null. */
  conferences: { id: number; letter: string | null }[];
}

/** Divisions that share a code and end in " A", " B"… are one division's conferences. */
export function conferenceGroups(divisions: { id: number; name: string; code: string | null }[]): ConferenceGroup[] {
  const out: ConferenceGroup[] = [];
  const byCode = new Map<string, ConferenceGroup>();
  for (const d of divisions) {
    const m = / ([A-Z])$/.exec(d.name);
    const shared = d.code ? divisions.filter((x) => x.code === d.code).length > 1 : false;
    if (!m || !shared) {
      out.push({ name: d.name, code: d.code, conferences: [{ id: d.id, letter: null }] });
      continue;
    }
    const group = byCode.get(d.code!);
    if (group) {
      group.conferences.push({ id: d.id, letter: m[1] });
    } else {
      const g: ConferenceGroup = { name: d.name.slice(0, -2), code: d.code, conferences: [{ id: d.id, letter: m[1] }] };
      byCode.set(d.code!, g);
      out.push(g);
    }
  }
  return out;
}

/** The group a division id belongs to (and its conference letter). */
export function groupOf(groups: ConferenceGroup[], divisionId: number): ConferenceGroup | null {
  return groups.find((g) => g.conferences.some((c) => c.id === divisionId)) ?? null;
}

type Option = { value: string; label: string };

/** The Division select and, for a division split into conferences, the Conference select. */
export interface DivisionPicker {
  division: { value: string; options: Option[] };
  conference: { value: string; options: Option[] } | null;
}

/** Standings: always one conference; picking a division opens `preferred` (the viewer's) conference. */
export function standingsPicker(
  groups: ConferenceGroup[],
  currentId: number,
  mine: Set<number> = new Set()
): DivisionPicker {
  const preferred = (g: ConferenceGroup) => (g.conferences.find((c) => mine.has(c.id)) ?? g.conferences[0]).id;
  const current = groupOf(groups, currentId) ?? groups[0];
  const yours = (ids: number[]) => (ids.some((id) => mine.has(id)) ? " · your team" : "");
  return {
    division: {
      value: String(preferred(current)),
      options: groups.map((g) => ({ value: String(preferred(g)), label: `${g.name}${yours(g.conferences.map((c) => c.id))}` })),
    },
    conference:
      current.conferences.length > 1
        ? {
            value: String(currentId),
            options: current.conferences.map((c) => ({ value: String(c.id), label: `Conference ${c.letter}${yours([c.id])}` })),
          }
        : null,
  };
}

/** A Teams/Stats ?division=: one division or conference (its id), a split division's code (all its conferences), or all. */
export interface DivisionFilter {
  /** The division ids shown; null = every division. */
  ids: number[] | null;
  group: ConferenceGroup | null;
  /** The ?division= value ("" = all). */
  value: string;
}

export function parseDivisionFilter(raw: unknown, groups: ConferenceGroup[]): DivisionFilter {
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const group = groupOf(groups, Number(raw));
    if (group) return { ids: [Number(raw)], group, value: raw };
  }
  if (typeof raw === "string") {
    const group = groups.find((g) => g.code === raw && g.conferences.length > 1);
    if (group) return { ids: group.conferences.map((c) => c.id), group, value: raw };
  }
  return { ids: null, group: null, value: "" };
}

/** Teams/Stats: "All divisions" and "All conferences" as well. `suffix` adds e.g. a match count. */
export function filterPicker(
  groups: ConferenceGroup[],
  filter: DivisionFilter,
  suffix: (ids: number[]) => string = () => ""
): DivisionPicker {
  const groupValue = (g: ConferenceGroup) => (g.conferences.length > 1 && g.code ? g.code : String(g.conferences[0].id));
  const g = filter.group;
  return {
    division: {
      value: g ? groupValue(g) : "",
      options: [
        { value: "", label: "All divisions" },
        ...groups.map((x) => ({ value: groupValue(x), label: `${x.name}${suffix(x.conferences.map((c) => c.id))}` })),
      ],
    },
    conference:
      g && g.conferences.length > 1 && g.code
        ? {
            value: filter.value,
            options: [
              { value: g.code, label: `All conferences${suffix(g.conferences.map((c) => c.id))}` },
              ...g.conferences.map((c) => ({ value: String(c.id), label: `Conference ${c.letter}${suffix([c.id])}` })),
            ],
          }
        : null,
  };
}
