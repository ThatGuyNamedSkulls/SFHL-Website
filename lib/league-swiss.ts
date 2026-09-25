/**
 * Swiss regular season and season-end moves (docs/LEAGUE_V2_PLAN.md, Part B).
 * Same rules as the bot's core/league_swiss.py, checked against the same
 * examples (tests/league-vectors.json). The weekly pairing after week 1 runs
 * in the bot's league loop only, so it isn't ported here.
 *
 * - Up to 7 teams play a round-robin; more play Swiss. Divisions over 32 teams
 *   split into conferences A, B, C…
 * - Week 1: seed 1 v seed n/2+1, 2 v n/2+2…; the weakest sits out when odd.
 * - A bye counts as a win. Swiss ties: points, Buchholz, round difference,
 *   rounds won, team id.
 * - Season end: each conference's top k go up and bottom k go down
 *   (k = 4 in big conferences, fewer in small ones):
 *   Open 8-9 → Open10 → Entry → Intermediate → Main → Advanced → Pro.
 *   Open 5-7 and 1-4 never move; Open 8-9 and Open10 never go down (an Open
 *   team's level comes from its players' Elo, so Open10 only goes up).
 */

export const ROUND_ROBIN_MAX = 7;
export const CONFERENCE_MAX = 32;
export const MOVES_MAX = 4;
/** The earned ladder, low → high. */
export const LADDER = ["open10", "entry", "intermediate", "main", "advanced", "pro"] as const;

export type DivisionFormat = "rr" | "swiss";

export function conferenceSizes(teamCount: number): number[] {
  const k = Math.max(1, Math.ceil(teamCount / CONFERENCE_MAX));
  const base = Math.floor(teamCount / k);
  const extra = teamCount % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export function formatFor(teamCount: number): DivisionFormat {
  return teamCount <= ROUND_ROBIN_MAX ? "rr" : "swiss";
}

/** Week 1 from the seeds (strongest first). Returns [pairs, bye]. */
export function firstRound(teamIds: string[]): [[string, string][], string | null] {
  const teams = [...teamIds];
  const bye = teams.length % 2 ? teams.pop()! : null;
  const half = teams.length / 2;
  return [Array.from({ length: half }, (_, i) => [teams[i], teams[i + half]] as [string, string]), bye];
}

interface SwissMatch {
  team_a?: string;
  team_b?: string;
  teamA?: string;
  teamB?: string;
  status: string;
  winner: string | null;
  score_a?: number | null;
  score_b?: number | null;
  scoreA?: number | null;
  scoreB?: number | null;
}

export interface SwissRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  roundsFor: number;
  roundsAgainst: number;
  rd: number;
  points: number;
  buchholz: number;
}

/** Swiss standings (same as core/league_swiss.py swiss_standings). */
export function swissStandings(teamIds: string[], matches: SwissMatch[], byes: { team_id?: string; teamId?: string }[]): SwissRow[] {
  const table = new Map<string, SwissRow>(
    teamIds.map((t) => [t, { teamId: t, played: 0, won: 0, lost: 0, roundsFor: 0, roundsAgainst: 0, rd: 0, points: 0, buchholz: 0 }])
  );
  const opponents = new Map<string, string[]>(teamIds.map((t) => [t, []]));
  for (const m of matches) {
    const ta = m.team_a ?? m.teamA!;
    const tb = m.team_b ?? m.teamB!;
    if ((m.status !== "final" && m.status !== "forfeit") || !m.winner) continue;
    const a = table.get(ta);
    const b = table.get(tb);
    if (!a || !b || (m.winner !== ta && m.winner !== tb)) continue;
    const [winner, loser] = m.winner === ta ? [a, b] : [b, a];
    a.played += 1;
    b.played += 1;
    winner.won += 1;
    winner.points += 3;
    loser.lost += 1;
    opponents.get(ta)!.push(tb);
    opponents.get(tb)!.push(ta);
    if (m.status === "forfeit") {
      loser.rd -= 1;
      continue;
    }
    const sa = Number(m.score_a ?? m.scoreA ?? 0);
    const sb = Number(m.score_b ?? m.scoreB ?? 0);
    a.roundsFor += sa;
    a.roundsAgainst += sb;
    b.roundsFor += sb;
    b.roundsAgainst += sa;
    a.rd += sa - sb;
    b.rd += sb - sa;
  }
  for (const bye of byes) {
    const row = table.get(bye.team_id ?? bye.teamId ?? "");
    if (row) {
      row.played += 1;
      row.won += 1;
      row.points += 3;
    }
  }
  for (const [t, row] of table) row.buchholz = opponents.get(t)!.reduce((s, o) => s + table.get(o)!.points, 0);
  return [...table.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.buchholz - x.buchholz ||
      y.rd - x.rd ||
      y.roundsFor - x.roundsFor ||
      (x.teamId < y.teamId ? -1 : x.teamId > y.teamId ? 1 : 0)
  );
}

// --- season-end moves ---------------------------------------------------------------------------

export function movesCount(teamCount: number): number {
  return Math.max(1, Math.min(MOVES_MAX, Math.floor((teamCount + 2) / 4)));
}

/** Where the top goes; null = nowhere (Pro, Open 5-7, Open 1-4). */
export function promotionTarget(code: string): string | null {
  if (code === "open89") return "open10";
  const i = (LADDER as readonly string[]).indexOf(code);
  return i >= 0 && i < LADDER.length - 1 ? LADDER[i + 1] : null;
}

/** Where the bottom goes; null = no relegation (Open10 and the Open skill bands only go up). */
export function relegationTarget(code: string): string | null {
  const i = (LADDER as readonly string[]).indexOf(code);
  return i > 0 ? LADDER[i - 1] : null;
}

export interface Move {
  teamId: string;
  direction: "up" | "down";
  from: string;
  to: string;
}

/** Pure: one conference's moves from its final places (1st first) and each team's own level. */
export function seasonMoves(places: string[], ownCodes: Record<string, string>): Move[] {
  const k = movesCount(places.length);
  const out: Move[] = [];
  places.forEach((team, i) => {
    const code = ownCodes[team] ?? "";
    if (i < k) {
      const to = promotionTarget(code);
      if (to !== null) out.push({ teamId: team, direction: "up", from: code, to });
    } else if (i >= places.length - k) {
      const to = relegationTarget(code);
      if (to !== null) out.push({ teamId: team, direction: "down", from: code, to });
    }
  });
  return out;
}
