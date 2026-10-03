/**
 * Site-wide match lists (/matches, the dashboard, the landing page) in the
 * profile's row style: per match the score, the lobby's average Elo, the best
 * player by rating, the map — and the viewer's own result when they played.
 * `summarizeMatch` is pure (tests/match-list.test.ts); `recentMatches` queries.
 */
import { client } from "@/lib/db";
import { getRankForElo } from "@/data/ranks";
import { prettyMap, prettyRegion } from "@/lib/format";
import { parseRoundScore, performanceRating } from "@/lib/match-stats";

export interface MatchRowData {
  matchId: number;
  playerName: string;
  result: string;
  kills: number;
  deaths: number;
  assists: number;
  mvps: number;
  points: number;
  roundScore: string | null;
  roundsPlayed: number | null;
  eloBefore: number | null;
  eloChange: number;
  placement: boolean;
}

export interface MatchSummary {
  matchId: number;
  /** UTC "YYYY-MM-DD HH:MM:SS". */
  date: string;
  map: string;
  region: string;
  /** "13:9", the winners' rounds first; "" when unknown. */
  score: string;
  players: number;
  /** Average Elo before the match of the ranked (non-placement) players, or null. */
  avgElo: number | null;
  avgRank: string;
  /** Best scoreboard rating in the lobby. */
  top: { name: string; rating: number; kills: number; deaths: number; assists: number } | null;
  /** The viewer's line, when they played. */
  mine: { result: "W" | "L"; eloChange: number; rating: number; score: string } | null;
}

function ratingOf(r: MatchRowData): number {
  const parsed = parseRoundScore(r.roundScore);
  const rounds = r.roundsPlayed && r.roundsPlayed > 0 ? r.roundsPlayed : parsed?.total ?? null;
  return performanceRating({ kills: r.kills, deaths: r.deaths, assists: r.assists, rounds, score: r.points, mvps: r.mvps });
}

/** One match's row from its players' lines. */
export function summarizeMatch(
  head: { matchId: number; date: string; map: string | null; region: string | null },
  rows: MatchRowData[],
  viewer?: string | null
): MatchSummary {
  const parsed = rows.map((r) => parseRoundScore(r.roundScore)).find(Boolean) ?? null;
  const hi = parsed ? Math.max(parsed.first, parsed.second) : null;
  const lo = parsed ? Math.min(parsed.first, parsed.second) : null;
  const ranked = rows.filter((r) => !r.placement && r.eloBefore != null && r.eloBefore > 0);
  const avgElo = ranked.length ? Math.round(ranked.reduce((s, r) => s + (r.eloBefore ?? 0), 0) / ranked.length) : null;
  let top: MatchSummary["top"] = null;
  for (const r of rows) {
    const rating = ratingOf(r);
    if (!top || rating > top.rating || (rating === top.rating && r.kills > top.kills)) {
      top = { name: r.playerName, rating, kills: r.kills, deaths: r.deaths, assists: r.assists };
    }
  }
  const me = viewer ? rows.find((r) => r.playerName.toLowerCase() === viewer.toLowerCase()) : undefined;
  const win = me?.result === "W";
  return {
    matchId: head.matchId,
    date: head.date,
    map: prettyMap(head.map),
    region: prettyRegion(head.region),
    score: hi != null ? `${hi}:${lo}` : "",
    players: new Set(rows.map((r) => r.playerName.toLowerCase())).size,
    avgElo,
    avgRank: avgElo ? getRankForElo(avgElo).letter : "UNRANKED",
    top,
    mine: me
      ? {
          result: win ? "W" : "L",
          eloChange: me.eloChange,
          rating: ratingOf(me),
          score: hi != null ? (win ? `${hi}:${lo}` : `${lo}:${hi}`) : "",
        }
      : null,
  };
}

/** The newest matches across the site, newest first (dummy matches left out). */
export async function recentMatches(opts: { limit: number; offset?: number; viewer?: string | null }): Promise<{
  matches: MatchSummary[];
  hasMore: boolean;
}> {
  const notTest = "AND COALESCE(is_test, 0) = 0";
  const headSql = (filter: string) => `
    SELECT match_id, MIN(timestamp) AS ts, MAX(map_name) AS map, MAX(region) AS region
    FROM match_history WHERE match_id IS NOT NULL ${filter}
    GROUP BY match_id ORDER BY ts DESC, match_id DESC LIMIT ? OFFSET ?`;
  const args = [opts.limit + 1, opts.offset ?? 0];
  let heads;
  try {
    heads = (await client.execute({ sql: headSql(notTest), args })).rows;
  } catch {
    heads = (await client.execute({ sql: headSql(""), args })).rows;
  }
  const hasMore = heads.length > opts.limit;
  heads = heads.slice(0, opts.limit);
  if (!heads.length) return { matches: [], hasMore: false };

  const ids = heads.map((h) => Number(h.match_id));
  const rowSql = (filter: string, cols: string) => `
    SELECT match_id, player_name, result, kills, deaths, assists, mvps, points, round_score, elo_before, elo_change,
           is_placement${cols}
    FROM match_history WHERE match_id IN (${ids.map(() => "?").join(",")}) ${filter}`;
  let rows;
  try {
    rows = (await client.execute({ sql: rowSql(notTest, ", rounds_played"), args: ids })).rows;
  } catch {
    rows = (await client.execute({ sql: rowSql("", ""), args: ids })).rows;
  }
  const byMatch = new Map<number, MatchRowData[]>();
  for (const r of rows) {
    const id = Number(r.match_id);
    const list = byMatch.get(id) ?? [];
    list.push({
      matchId: id,
      playerName: String(r.player_name ?? ""),
      result: String(r.result ?? ""),
      kills: Number(r.kills) || 0,
      deaths: Number(r.deaths) || 0,
      assists: Number(r.assists) || 0,
      mvps: Number(r.mvps) || 0,
      points: Number(r.points) || 0,
      roundScore: r.round_score == null ? null : String(r.round_score),
      roundsPlayed: r.rounds_played == null ? null : Number(r.rounds_played),
      eloBefore: r.elo_before == null ? null : Number(r.elo_before),
      eloChange: Number(r.elo_change) || 0,
      placement: Number(r.is_placement) === 1,
    });
    byMatch.set(id, list);
  }
  return {
    matches: heads.map((h) =>
      summarizeMatch(
        {
          matchId: Number(h.match_id),
          date: String(h.ts ?? ""),
          map: h.map == null ? null : String(h.map),
          region: h.region == null ? null : String(h.region),
        },
        byMatch.get(Number(h.match_id)) ?? [],
        opts.viewer
      )
    ),
    hasMore,
  };
}
