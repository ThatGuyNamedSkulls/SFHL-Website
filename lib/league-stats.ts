/**
 * League Stats (docs/LEAGUE_UI_PLAN.md step 9): Match Staff save each map's
 * scoreboard of a league match (league_match_stats), the match page shows it,
 * and the Stats tab adds it up per division. Never touches ranked stats.
 */
import { client } from "@/lib/db";
import { logEvent, type Actor } from "@/lib/league-admin";
import { ensureLeagueSchema, seasonDivisions, seasonEntries, seasonMatches, teamCountries, type TeamBadge } from "@/lib/league";
import { getLeagueMatch, matchTeam, type MatchTeam } from "@/lib/league-matches";
import { listTeams } from "@/lib/teams";
import {
  StatsInputError,
  playerTotals,
  validateScoreboard,
  type MapScoreboard,
  type MatchForStats,
  type PlayerTotals,
  type StatLine,
  type StatRow,
} from "@/lib/league-stats-rules";

export { StatsInputError };

type Row = Record<string, unknown>;

const rosterOf = (t: MatchTeam) => t.roster.map((p) => ({ discordId: p.discordId, name: p.playerName || p.username }));

async function loadMatch(matchId: number) {
  await ensureLeagueSchema();
  const match = await getLeagueMatch(matchId);
  if (!match) throw new StatsInputError("League match not found.");
  const [a, b] = [await matchTeam(match.seasonId, match.teamA), await matchTeam(match.seasonId, match.teamB)];
  const forStats: MatchForStats = {
    bo: match.bo,
    teamA: match.teamA,
    teamB: match.teamB,
    status: match.status,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    rosterA: rosterOf(a),
    rosterB: rosterOf(b),
  };
  return { match, a, b, forStats };
}

/** Staff: save (replace) one map's scoreboard. */
export async function saveMapStats(matchId: number, raw: Record<string, unknown>, actor: Actor): Promise<void> {
  const { match, a, b, forStats } = await loadMatch(matchId);
  const board = validateScoreboard(raw, forStats);
  const now = Date.now();
  const rounds = (teamId: string) =>
    teamId === match.teamA ? [board.roundsA, board.roundsB] : [board.roundsB, board.roundsA];
  await client.batch(
    [
      { sql: "DELETE FROM league_match_stats WHERE match_id = ? AND map_no = ?", args: [matchId, board.mapNo] },
      ...board.players.map((p) => ({
        sql: `INSERT INTO league_match_stats
                (season_id, match_id, map_no, map_name, team_id, discord_id, player_name,
                 kills, deaths, assists, mvps, score, hs, rounds_won, rounds_lost, entered_by, entered_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          match.seasonId, matchId, board.mapNo, board.mapName, p.teamId, p.discordId, p.name,
          p.kills, p.deaths, p.assists, p.mvps, p.score, p.hs, ...rounds(p.teamId), actor.discordId, now,
        ],
      })),
    ],
    "write"
  );
  await logEvent(
    match.seasonId,
    "stats_entered",
    actor,
    `${a.name} vs ${b.name} · map ${board.mapNo}${board.mapName ? ` (${board.mapName})` : ""} · ${board.roundsA}–${board.roundsB}`,
    matchId
  );
}

export async function deleteMapStats(matchId: number, mapNo: number, actor: Actor): Promise<void> {
  const { match, a, b } = await loadMatch(matchId);
  const rs = await client.execute({
    sql: "DELETE FROM league_match_stats WHERE match_id = ? AND map_no = ?",
    args: [matchId, mapNo],
  });
  if (!rs.rowsAffected) throw new StatsInputError("No stats saved for that map.");
  await logEvent(match.seasonId, "stats_removed", actor, `${a.name} vs ${b.name} · map ${mapNo}`, matchId);
}

/** The match page: every saved map scoreboard, in map order. */
export async function matchScoreboards(matchId: number, teamA: string): Promise<MapScoreboard[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT * FROM league_match_stats WHERE match_id = ? ORDER BY map_no, score DESC, kills DESC",
    args: [matchId],
  });
  const maps = new Map<number, MapScoreboard>();
  for (const r of rs.rows as Row[]) {
    const mapNo = Number(r.map_no);
    const teamId = String(r.team_id);
    let m = maps.get(mapNo);
    if (!m) {
      const won = Number(r.rounds_won);
      const lost = Number(r.rounds_lost);
      m = {
        mapNo,
        mapName: r.map_name == null ? null : String(r.map_name),
        roundsA: teamId === teamA ? won : lost,
        roundsB: teamId === teamA ? lost : won,
        players: [],
      };
      maps.set(mapNo, m);
    }
    const line: StatLine = {
      teamId,
      discordId: String(r.discord_id),
      name: String(r.player_name),
      kills: Number(r.kills),
      deaths: Number(r.deaths),
      assists: Number(r.assists),
      mvps: Number(r.mvps),
      score: Number(r.score),
      hs: Number(r.hs),
    };
    m.players.push(line);
  }
  return [...maps.values()];
}

export interface StatsTableRow extends PlayerTotals {
  team: TeamBadge;
  country: string | null;
}

/** The Stats tab: per-player totals for a season, one division or all. */
export async function seasonStats(seasonId: number, divisionId: number | null): Promise<StatsTableRow[]> {
  await ensureLeagueSchema();
  const matches = (await seasonMatches(seasonId)).filter((m) => divisionId === null || m.divisionId === divisionId);
  const ids = new Set(matches.map((m) => m.id));
  if (!ids.size) return [];
  const rs = await client.execute({ sql: "SELECT * FROM league_match_stats WHERE season_id = ? ORDER BY match_id, map_no", args: [seasonId] });
  const rows: StatRow[] = (rs.rows as Row[])
    .filter((r) => ids.has(Number(r.match_id)))
    .map((r) => ({
      matchId: Number(r.match_id),
      mapNo: Number(r.map_no),
      teamId: String(r.team_id),
      discordId: String(r.discord_id),
      name: String(r.player_name),
      kills: Number(r.kills),
      deaths: Number(r.deaths),
      assists: Number(r.assists),
      mvps: Number(r.mvps),
      score: Number(r.score),
      hs: Number(r.hs),
      roundsWon: Number(r.rounds_won),
      roundsLost: Number(r.rounds_lost),
    }));
  const totals = playerTotals(rows, new Map(matches.map((m) => [m.id, m.winner])));
  const teams = new Map((await listTeams()).map((t) => [t.id, t]));
  const entries = new Map((await seasonEntries(seasonId)).map((e) => [e.teamId, e]));
  const countries = await teamCountries(new Map(totals.map((t) => [t.discordId, [t.name]])));
  return totals.map((t) => {
    const team = teams.get(t.teamId);
    return {
      ...t,
      team: {
        id: t.teamId,
        name: team?.name ?? entries.get(t.teamId)?.teamName ?? "Unknown team",
        tag: team?.tag ?? entries.get(t.teamId)?.teamTag ?? "",
        logoUrl: team?.logoUrl ?? null,
        accentColor: team?.accentColor ?? "#ff5500",
      },
      country: countries.get(t.discordId) ?? null,
    };
  });
}

/** Divisions with at least one saved scoreboard (the Stats tab's chips show counts). */
export async function statsDivisions(seasonId: number) {
  await ensureLeagueSchema();
  const divisions = await seasonDivisions(seasonId);
  const rs = await client.execute({
    sql: `SELECT m.division_id AS d, COUNT(DISTINCT s.match_id) AS n
          FROM league_match_stats s JOIN league_matches m ON m.id = s.match_id
          WHERE s.season_id = ? GROUP BY m.division_id`,
    args: [seasonId],
  });
  const counts = new Map((rs.rows as Row[]).map((r) => [Number(r.d), Number(r.n)]));
  return divisions.map((d) => ({ id: d.id, name: d.name, matches: counts.get(d.id) ?? 0 }));
}
