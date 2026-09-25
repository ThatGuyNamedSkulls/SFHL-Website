/**
 * A team's league record for its FACEIT-style team page (docs/LEAGUE_V2_PLAN.md
 * D4): every league match it played (all seasons), main statistics (played, win
 * rate, longest win streak, recent results), map preferences (team and per
 * player) and per-match performance for the chart — from league_matches and
 * the scoreboards Match Staff saved (league_match_stats).
 */
import { client } from "@/lib/db";
import { ensureLeagueSchema, type TeamBadge } from "@/lib/league";
import { listTeams } from "@/lib/teams";

const WEEK = 7 * 86_400_000;

export interface TeamMatch {
  id: number;
  seasonId: number;
  seasonName: string;
  division: string | null;
  /** When it was (or is) played: the agreed time, else the start of its week. */
  date: number | null;
  stage: string;
  round: string | null;
  opponent: TeamBadge;
  /** null = not played yet. */
  result: "W" | "L" | null;
  forfeit: boolean;
  scoreFor: number | null;
  scoreAgainst: number | null;
  /** Map names from the saved scoreboard, in order. */
  maps: string[];
}

export interface StatLine {
  matchId: number;
  mapNo: number;
  map: string | null;
  player: string;
  kills: number;
  deaths: number;
  hs: number;
  score: number;
  roundsWon: number;
  roundsLost: number;
}

export interface MapPref {
  map: string;
  played: number;
  wins: number;
  /** 0–100, rounded. */
  winRate: number;
}

export interface PerfValues {
  kd: number;
  kills: number;
  hs: number;
  score: number;
}

export interface TeamSummary {
  played: number;
  won: number;
  winRate: number;
  longestStreak: number;
  /** Newest first, at most 5. */
  recent: ("W" | "L")[];
  maps: MapPref[];
  /** Player name → their maps (for the player chips). */
  playerMaps: Record<string, MapPref[]>;
  /** The chart: up to 8 players (most maps first), one point per match with a scoreboard, oldest first. */
  performance: {
    players: string[];
    points: { matchId: number; label: string; date: number | null; values: Record<string, PerfValues> }[];
  };
}

/** Chart players are capped at the eight categorical colours (never cycled). */
export const PERFORMANCE_PLAYERS_MAX = 8;

const chrono = (a: TeamMatch, b: TeamMatch) => a.seasonId - b.seasonId || (a.date ?? 0) - (b.date ?? 0) || a.id - b.id;

function prefs(entries: { map: string; won: boolean }[]): MapPref[] {
  const by = new Map<string, MapPref>();
  for (const e of entries) {
    const p = by.get(e.map) ?? { map: e.map, played: 0, wins: 0, winRate: 0 };
    p.played += 1;
    if (e.won) p.wins += 1;
    by.set(e.map, p);
  }
  return [...by.values()]
    .map((p) => ({ ...p, winRate: Math.round((p.wins / p.played) * 100) }))
    .sort((a, b) => b.played - a.played || b.winRate - a.winRate || a.map.localeCompare(b.map));
}

/** Pure: the team's summary from its matches (any order) and its own scoreboard lines. */
export function summarizeTeam(matches: TeamMatch[], lines: StatLine[]): TeamSummary {
  const played = matches.filter((m) => m.result).sort(chrono);
  const won = played.filter((m) => m.result === "W").length;
  let streak = 0;
  let longestStreak = 0;
  for (const m of played) {
    streak = m.result === "W" ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
  }

  // Maps: one entry per (match, map) for the team; per player, one per map they played.
  const teamMaps = new Map<string, { map: string; won: boolean }>();
  const byPlayer = new Map<string, { map: string; won: boolean }[]>();
  for (const l of lines) {
    const map = l.map || "Unknown map";
    const won = l.roundsWon > l.roundsLost;
    teamMaps.set(`${l.matchId}:${l.mapNo}`, { map, won });
    byPlayer.set(l.player, [...(byPlayer.get(l.player) ?? []), { map, won }]);
  }

  const players = [...byPlayer.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, PERFORMANCE_PLAYERS_MAX)
    .map(([p]) => p);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const withStats = [...new Set(lines.map((l) => l.matchId))]
    .map((id) => matchById.get(id))
    .filter((m): m is TeamMatch => !!m)
    .sort(chrono);
  const points = withStats.map((m) => {
    const values: Record<string, PerfValues> = {};
    for (const p of players) {
      const mine = lines.filter((l) => l.matchId === m.id && l.player === p);
      if (!mine.length) continue;
      const kills = mine.reduce((s, l) => s + l.kills, 0);
      const deaths = mine.reduce((s, l) => s + l.deaths, 0);
      values[p] = {
        kd: Math.round((kills / Math.max(1, deaths)) * 100) / 100,
        kills,
        hs: kills ? Math.round((mine.reduce((s, l) => s + l.hs * l.kills, 0) / kills) * 10) / 10 : 0,
        score: Math.round(mine.reduce((s, l) => s + l.score, 0) / mine.length),
      };
    }
    return { matchId: m.id, label: `vs ${m.opponent.name}`, date: m.date, values };
  });

  return {
    played: played.length,
    won,
    winRate: played.length ? Math.round((won / played.length) * 100) : 0,
    longestStreak,
    recent: played.slice(-5).reverse().map((m) => m.result!) ,
    maps: prefs([...teamMaps.values()]),
    playerMaps: Object.fromEntries([...byPlayer.entries()].map(([p, e]) => [p, prefs(e)])),
    performance: { players, points },
  };
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Every league match of a team (all seasons, newest first) and its scoreboard lines. */
export async function teamLeagueMatches(teamId: string): Promise<{ matches: TeamMatch[]; lines: StatLine[] }> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: `SELECT m.*, s.name AS season_name, s.start_date AS season_start, d.name AS division_name
          FROM league_matches m
          JOIN league_seasons s ON s.id = m.season_id
          LEFT JOIN league_divisions d ON d.id = m.division_id
          WHERE (m.team_a = ? OR m.team_b = ?) AND s.status != 'cancelled'`,
    args: [teamId, teamId],
  });
  const statRs = await client.execute({
    sql: "SELECT * FROM league_match_stats WHERE team_id = ? ORDER BY match_id, map_no",
    args: [teamId],
  });
  const lines: StatLine[] = (statRs.rows as Row[]).map((r) => ({
    matchId: Number(r.match_id),
    mapNo: Number(r.map_no),
    map: r.map_name == null ? null : String(r.map_name),
    player: String(r.player_name),
    kills: Number(r.kills),
    deaths: Number(r.deaths),
    hs: Number(r.hs),
    score: Number(r.score),
    roundsWon: Number(r.rounds_won),
    roundsLost: Number(r.rounds_lost),
  }));
  const mapsOf = new Map<number, string[]>();
  for (const l of lines) {
    const list = mapsOf.get(l.matchId) ?? [];
    if (l.map && list.length < l.mapNo) list[l.mapNo - 1] = l.map;
    mapsOf.set(l.matchId, list);
  }
  const teams = new Map((await listTeams()).map((t) => [t.id, t]));
  const matches = (rs.rows as Row[]).map((r): TeamMatch => {
    const home = String(r.team_a) === teamId;
    const otherId = String(home ? r.team_b : r.team_a);
    const other = teams.get(otherId);
    const done = (r.status === "final" || r.status === "forfeit") && r.winner;
    const start = num(r.season_start);
    return {
      id: Number(r.id),
      seasonId: Number(r.season_id),
      seasonName: String(r.season_name),
      division: r.division_name == null ? null : String(r.division_name),
      date: num(r.scheduled_at) ?? (start !== null ? start + (Number(r.week) - 1) * WEEK : null),
      stage: String(r.stage),
      round: r.playoff_round == null ? null : String(r.playoff_round),
      opponent: {
        id: otherId,
        name: other?.name ?? "Unknown team",
        tag: other?.tag ?? "",
        logoUrl: other?.logoUrl ?? null,
        accentColor: other?.accentColor ?? "#ff5500",
      },
      result: done ? (String(r.winner) === teamId ? "W" : "L") : null,
      forfeit: r.status === "forfeit",
      scoreFor: num(home ? r.score_a : r.score_b),
      scoreAgainst: num(home ? r.score_b : r.score_a),
      maps: (mapsOf.get(Number(r.id)) ?? []).filter(Boolean),
    };
  });
  matches.sort((a, b) => chrono(b, a));
  return { matches, lines };
}
