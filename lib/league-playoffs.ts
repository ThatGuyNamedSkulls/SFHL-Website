/**
 * Team League playoffs and season end on the website (phase 4). Same rules as
 * the bot's core/league_playoffs.py, checked against the same examples
 * (tests/league-vectors.json):
 *
 * - Playoffs: top 4 of each division, best-of-3 semis (1 v 4, 2 v 3); when
 *   both semis are done the final and a third-place match are created.
 * - Season end: final places, a team title for each division champion, HL
 *   Coins for every rostered player of the top 3 (5,000 / 2,500 / 1,000) and
 *   no promotion/relegation — named divisions are invite-only (Match Staff give
 *   a team access by hand); everyone else plays in their Open skill band.
 */
import { client } from "@/lib/db";
import { claim, logEvent, LeagueAdminError, type Actor } from "@/lib/league-admin";
import {
  computeStandings,
  ensureLeagueSchema,
  getSeason,
  seasonDivisions,
  seasonEntries,
  seasonMatches,
  type LeagueMatch,
  type PlayoffRound,
  type Season,
} from "@/lib/league";

export const PLAYOFF_TEAMS = 4;
export const PRIZES = [5000, 2500, 1000];
export const BO_PLAYOFF = 3;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const done = (m: { status: string }) => m.status === "final" || m.status === "forfeit";
const fail = (message: string): never => {
  throw new LeagueAdminError(message);
};

// --- pure rules --------------------------------------------------------------------------------

/** [round, higher seed, lower seed]: 1 v 4 and 2 v 3. */
export function semiPairs(standingIds: string[]): [PlayoffRound, string, string][] {
  const s = standingIds.slice(0, PLAYOFF_TEAMS);
  return [
    ["semi1", s[0], s[3]],
    ["semi2", s[1], s[2]],
  ];
}

export function loserOf(m: { teamA?: string; teamB?: string; team_a?: string; team_b?: string; winner: string | null }): string {
  const a = m.teamA ?? m.team_a!;
  const b = m.teamB ?? m.team_b!;
  return m.winner === a ? b : a;
}

/** Team ids from 1st to last: the playoffs decide 1–4, the standings the rest. */
export function finalPlaces(
  standingIds: string[],
  final: { team_a?: string; team_b?: string; teamA?: string; teamB?: string; winner: string | null },
  third: { team_a?: string; team_b?: string; teamA?: string; teamB?: string; winner: string | null }
): string[] {
  const top = [final.winner!, loserOf(final), third.winner!, loserOf(third)];
  return [...top, ...standingIds.filter((t) => !top.includes(t))];
}

export function weekOf(startDate: number, now: number): number {
  return Math.floor((now - startDate) / WEEK) + 1;
}

/** First match week ≥ `earliest` that still has time to schedule (past its Friday deadline → next week). */
export function playoffWeek(startDate: number, earliest: number, now: number): number {
  let week = Math.max(earliest, weekOf(startDate, now));
  if (now >= startDate + (week - 1) * WEEK + 5 * DAY) week += 1;
  return week;
}

// --- database steps ------------------------------------------------------------------------------

async function seasonOrFail(seasonId: number): Promise<Season> {
  const season = await getSeason(seasonId);
  if (!season) fail("Season not found.");
  return season!;
}

/** Regular-season standings per division id (team ids, 1st first). */
export async function divisionStandings(seasonId: number): Promise<Map<number, string[]>> {
  const matches = (await seasonMatches(seasonId)).filter((m) => m.stage === "regular");
  const entries = await seasonEntries(seasonId);
  const out = new Map<number, string[]>();
  for (const d of await seasonDivisions(seasonId)) {
    const teams = entries.filter((e) => e.divisionId === d.id && e.status === "active").map((e) => e.teamId);
    out.set(d.id, computeStandings(teams, matches.filter((m) => m.divisionId === d.id)).map((r) => r.teamId));
  }
  return out;
}

function insertPlayoff(season: Season, divisionId: number, week: number, round: PlayoffRound, a: string, b: string) {
  return {
    sql: `INSERT OR IGNORE INTO league_matches
            (season_id, division_id, week, stage, team_a, team_b, bo, status, playoff_round, updated_at)
          VALUES (?, ?, ?, 'playoff', ?, ?, ?, 'unscheduled', ?, ?)`,
    args: [season.id, divisionId, week, a, b, BO_PLAYOFF, round, Date.now()],
  };
}

/** Seed the semi-finals from the regular-season standings. Returns the playoff week. */
export async function startPlayoffs(seasonId: number, actor: Actor, now = Date.now()): Promise<number> {
  await ensureLeagueSchema();
  const season = await seasonOrFail(seasonId);
  if (season.status !== "regular" || !season.startDate) fail("Playoffs start after the regular season.");
  const open = (await seasonMatches(season.id)).filter((m) => m.stage === "regular" && !done(m));
  if (open.length) {
    fail(`${open.length} regular-season match${open.length === 1 ? "" : "es"} still need a result. Settle them first (Needs staff).`);
  }
  const standings = await divisionStandings(season.id);
  if ([...standings.values()].some((ids) => ids.length < PLAYOFF_TEAMS)) {
    fail("Every division needs at least 4 teams for the playoffs.");
  }
  const week = playoffWeek(season.startDate!, season.weeks + 1, now);
  if (!(await claim(season.id, ["regular"], "playoffs"))) {
    fail("The playoffs were already started (from Discord or the website).");
  }
  try {
    await client.batch(
      [...standings.entries()].flatMap(([divId, ids]) =>
        semiPairs(ids).map(([round, a, b]) => insertPlayoff(season, divId, week, round, a, b))
      ),
      "write"
    );
  } catch (error) {
    await claim(season.id, ["playoffs"], "regular");
    throw error;
  }
  await logEvent(season.id, "playoffs_started", actor, `week ${week}`);
  return week;
}

/** Both semis done → the final + third-place match exist. Safe to call any time (bot or website). */
export async function advancePlayoffs(seasonId: number, now = Date.now()): Promise<number[]> {
  const season = await getSeason(seasonId);
  if (!season || season.status !== "playoffs" || !season.startDate) return [];
  const matches = (await seasonMatches(season.id)).filter((m) => m.stage === "playoff");
  const divisionIds = [...new Set(matches.map((m) => m.divisionId).filter((d): d is number => d !== null))];
  const advanced: number[] = [];
  for (const divId of divisionIds) {
    const round = (r: PlayoffRound) => matches.find((m) => m.divisionId === divId && m.playoffRound === r);
    const s1 = round("semi1");
    const s2 = round("semi2");
    if (round("final") || !s1 || !s2 || !done(s1) || !done(s2)) continue;
    const week = playoffWeek(season.startDate!, Math.max(s1.week, s2.week) + 1, now);
    await client.batch(
      [
        insertPlayoff(season, divId, week, "final", s1.winner!, s2.winner!),
        insertPlayoff(season, divId, week, "third", loserOf(s1), loserOf(s2)),
      ],
      "write"
    );
    advanced.push(divId);
  }
  return advanced;
}

/** After a result on the website: advance the playoffs of that match's season. */
export async function afterResult(match: Pick<LeagueMatch, "stage"> & { seasonId: number }): Promise<void> {
  if (match.stage === "playoff") await advancePlayoffs(match.seasonId);
}

export interface SeasonEndDivision {
  divisionId: number;
  name: string;
  tier: number;
  places: string[];
  standings: string[];
  champion: string;
}

/** What ending the season would do — nothing is written. */
export async function previewEnd(seasonId: number): Promise<{ divisions: SeasonEndDivision[] }> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "playoffs") fail("A season ends after its playoffs.");
  const matches = (await seasonMatches(season.id)).filter((m) => m.stage === "playoff");
  const standings = await divisionStandings(season.id);
  const divisions: SeasonEndDivision[] = [];
  for (const d of await seasonDivisions(season.id)) {
    const final = matches.find((m) => m.divisionId === d.id && m.playoffRound === "final");
    const third = matches.find((m) => m.divisionId === d.id && m.playoffRound === "third");
    if (!final || !third || !done(final) || !done(third)) fail(`${d.name}'s final and third-place match need results first.`);
    const places = finalPlaces(standings.get(d.id) ?? [], final!, third!);
    divisions.push({ divisionId: d.id, name: d.name, tier: d.tier, places, standings: standings.get(d.id) ?? [], champion: places[0] });
  }
  return { divisions };
}

/** Final places, champion titles and prizes; the season is finished. */
export async function endSeason(seasonId: number, confirmName: string, actor: Actor) {
  const season = await seasonOrFail(seasonId);
  if (confirmName.trim() !== season.name) fail(`Type the season name (${season.name}) to confirm.`);
  const plan = await previewEnd(seasonId);
  if (!(await claim(season.id, ["playoffs"], "finished"))) {
    fail("The season was already ended (from Discord or the website).");
  }
  await client.batch(
    plan.divisions.flatMap((d) =>
      d.places.map((teamId, i) => ({
        sql: "UPDATE league_entries SET final_place = ?, prize = ? WHERE season_id = ? AND team_id = ?",
        args: [i + 1, PRIZES[i] ?? 0, season.id, teamId],
      }))
    ),
    "write"
  );
  // Champion titles — same table as /awardtitle (lib/team-titles.ts reads it).
  await client.execute(`CREATE TABLE IF NOT EXISTS team_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, team_id TEXT NOT NULL, title TEXT NOT NULL,
    awarded_by TEXT, awarded_by_id TEXT, awarded_at INTEGER NOT NULL)`);
  const now = Date.now();
  await client.batch(
    plan.divisions.map((d) => ({
      sql: "INSERT INTO team_titles (team_id, title, awarded_by, awarded_by_id, awarded_at) VALUES (?, ?, 'League', NULL, ?)",
      args: [d.champion, `${season.name} — ${d.name} Champions`.slice(0, 60), now],
    })),
    "write"
  );
  // Prizes: HL Coins to every rostered player of the top 3.
  const entries = await seasonEntries(season.id);
  const grants = entries.flatMap((e) => {
    const place = plan.divisions.find((d) => d.places.includes(e.teamId))?.places.indexOf(e.teamId) ?? -1;
    const prize = place >= 0 ? PRIZES[place] ?? 0 : 0;
    return prize
      ? e.roster
          .filter((p) => p.playerName)
          .map((p) => ({ sql: "UPDATE players SET coins = COALESCE(coins, 0) + ? WHERE name = ?", args: [prize, p.playerName!] }))
      : [];
  });
  if (grants.length) await client.batch(grants, "write");
  await logEvent(season.id, "season_finished", actor, plan.divisions.map((d) => d.name).join(", "));
  return plan;
}
