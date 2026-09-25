/**
 * The Pro leaderboard's league details (docs/LEAGUE_V2_PLAN.md C6): for each
 * player on the Pro ladder, how many league matches counted, the Elo change of
 * the latest one, and the division and team it was played in. Read from
 * league_pro_elo, which the bot fills when it rebuilds the ladder.
 */
import { client } from "@/lib/db";
import { ensureLeagueSchema } from "@/lib/league";
import { listTeams } from "@/lib/teams";

export interface ProRow {
  player: string;
  matchId: number;
  seasonId: number;
  week: number;
  teamId: string;
  before: number;
  after: number;
  division: string | null;
  code: string | null;
}

export interface ProLeagueInfo {
  /** League matches that gave Pro Elo. */
  matches: number;
  /** Elo change of the latest one. */
  lastDelta: number;
  /** Where the latest one was played ("Open 10 A", "Pro/Advanced"). */
  division: string | null;
  code: string | null;
  teamId: string;
  seasonId: number;
}

/** Pure: per player (lower-case name), latest match = highest season, week, match id. */
export function summarizeProRows(rows: ProRow[]): Map<string, ProLeagueInfo> {
  const sorted = [...rows].sort((a, b) => a.seasonId - b.seasonId || a.week - b.week || a.matchId - b.matchId);
  const out = new Map<string, ProLeagueInfo>();
  for (const r of sorted) {
    const key = r.player.toLowerCase();
    const prev = out.get(key);
    out.set(key, {
      matches: (prev?.matches ?? 0) + 1,
      lastDelta: r.after - r.before,
      division: r.division,
      code: r.code,
      teamId: r.teamId,
      seasonId: r.seasonId,
    });
  }
  return out;
}

export interface ProLeagueView extends ProLeagueInfo {
  team: { id: string; name: string; tag: string } | null;
}

export async function proLeagueInfo(): Promise<Map<string, ProLeagueView>> {
  await ensureLeagueSchema();
  const rs = await client.execute(`
    SELECT p.player_name, p.match_id, p.season_id, p.team_id, p.elo_before, p.elo_after,
           m.week, d.name AS division, d.code
    FROM league_pro_elo p
    LEFT JOIN league_matches m ON m.id = p.match_id
    LEFT JOIN league_divisions d ON d.id = m.division_id`);
  const summary = summarizeProRows(
    (rs.rows as Record<string, unknown>[]).map((r) => ({
      player: String(r.player_name),
      matchId: Number(r.match_id),
      seasonId: Number(r.season_id),
      week: Number(r.week ?? 0),
      teamId: String(r.team_id),
      before: Number(r.elo_before),
      after: Number(r.elo_after),
      division: r.division == null ? null : String(r.division),
      code: r.code == null ? null : String(r.code),
    }))
  );
  const teams = new Map((await listTeams()).map((t) => [t.id, t]));
  const out = new Map<string, ProLeagueView>();
  for (const [name, info] of summary) {
    const t = teams.get(info.teamId);
    out.set(name, { ...info, team: t ? { id: t.id, name: t.name, tag: t.tag } : null });
  }
  return out;
}
