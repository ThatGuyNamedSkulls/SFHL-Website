/**
 * The Track page (docs/TRACK_UI_PLAN.md): a player's ranked matches over a
 * chosen range and the period before it, and the averages of their skill tier
 * this season to compare with. Ranked matches only — no placement or dummy
 * (/rank testdummies) games — like the profile.
 */
import { ROUNDS_SQL, client, selectMatchRows, toDbTimestamp, type DbMatch } from "@/lib/db";
import { prettyMap } from "@/lib/format";
import { remember } from "@/lib/server-cache";
import type { TrackRange } from "@/lib/track-link";

/** Rows per period for "this season" and "career", so one page can't pull a whole history. */
export const TRACK_ROW_CAP = 500;
/** The tier average is only shown once the tier has this many matches this season. */
export const BENCHMARK_MIN_MATCHES = 50;

export interface MatchQuery {
  limit: number;
  /** UTC "YYYY-MM-DD HH:MM:SS" bounds: since ≤ timestamp < until. */
  since?: string | null;
  until?: string | null;
  /** Raw map_name values (one map can be stored under several spellings). */
  maps?: string[] | null;
  mode?: string | null;
}

const PLAYER_ROWS = "(player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?)";

/** A player's ranked matches, newest first. */
export async function getPlayerMatches(playerName: string, q: MatchQuery): Promise<DbMatch[]> {
  const where = [PLAYER_ROWS, "COALESCE(is_placement, 0) = 0"];
  const args: (string | number)[] = [playerName, playerName];
  if (q.since) {
    where.push("timestamp >= ?");
    args.push(q.since);
  }
  if (q.until) {
    where.push("timestamp < ?");
    args.push(q.until);
  }
  if (q.maps?.length) {
    where.push(`map_name IN (${q.maps.map(() => "?").join(",")})`);
    args.push(...q.maps);
  }
  if (q.mode) {
    where.push("mode = ?");
    args.push(q.mode);
  }
  const base = `FROM match_history WHERE ${where.join(" AND ")}`;
  try {
    return await selectMatchRows(`${base} AND COALESCE(is_test, 0) = 0 ORDER BY id DESC LIMIT ?`, [...args, q.limit]);
  } catch {
    return selectMatchRows(`${base} ORDER BY id DESC LIMIT ?`, [...args, q.limit]);
  }
}

export interface TrackOptions {
  /** One entry per map name as shown; `value` lists its stored spellings joined by "|". */
  maps: { value: string; label: string }[];
  modes: string[];
}

/** The maps and gamemodes a player has ranked matches on, for the filters. */
export async function getTrackOptions(playerName: string): Promise<TrackOptions> {
  try {
    const rs = await client.execute({
      sql: `SELECT DISTINCT map_name, mode FROM match_history
            WHERE ${PLAYER_ROWS} AND COALESCE(is_placement, 0) = 0 AND COALESCE(is_test, 0) = 0`,
      args: [playerName, playerName],
    });
    const byLabel = new Map<string, Set<string>>();
    const modes = new Set<string>();
    for (const r of rs.rows) {
      if (r.map_name != null && r.map_name !== "") {
        const raw = String(r.map_name);
        const label = prettyMap(raw) || raw;
        byLabel.set(label, (byLabel.get(label) ?? new Set()).add(raw));
      }
      if (r.mode != null && r.mode !== "") modes.add(String(r.mode));
    }
    return {
      maps: [...byLabel.entries()]
        .map(([label, raws]) => ({ value: [...raws].sort().join("|"), label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      modes: [...modes].sort(),
    };
  } catch {
    return { maps: [], modes: [] };
  }
}

export interface TrackWindows {
  current: DbMatch[];
  /** The period before, or null when there's nothing to compare with (career). */
  previous: DbMatch[] | null;
  /** True when "this season" / "career" hit TRACK_ROW_CAP (only the newest rows). */
  truncated: boolean;
  /** "the 20 matches before", "last season", … (null with no comparison). */
  compare: string | null;
}

/**
 * The range's matches and the period before it. Last N: the newest 2N rows,
 * split in half. 7 / 30 days: the last 14 / 60 days, split by date. This
 * season: since the last reset, compared with the season before. Career: no
 * comparison.
 */
export async function trackWindows(
  playerName: string,
  range: TrackRange,
  filters: { maps?: string[] | null; mode?: string | null },
  resets: string[],
  now = Date.now()
): Promise<TrackWindows> {
  if (range === "last20" || range === "last50") {
    const n = range === "last20" ? 20 : 50;
    const rows = await getPlayerMatches(playerName, { ...filters, limit: 2 * n });
    const previous = rows.slice(n);
    return {
      current: rows.slice(0, n),
      previous: previous.length ? previous : null,
      truncated: false,
      compare: `the ${n} matches before`,
    };
  }
  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    const cut = toDbTimestamp(new Date(now - days * 86_400_000));
    const rows = await getPlayerMatches(playerName, {
      ...filters,
      since: toDbTimestamp(new Date(now - 2 * days * 86_400_000)),
      limit: 2 * TRACK_ROW_CAP,
    });
    const current = rows.filter((m) => (m.timestamp || "") >= cut);
    const previous = rows.filter((m) => (m.timestamp || "") < cut);
    return {
      current,
      previous: previous.length ? previous : null,
      truncated: rows.length === 2 * TRACK_ROW_CAP,
      compare: `the ${days} days before`,
    };
  }
  if (range === "season") {
    const start = resets.length ? resets[resets.length - 1] : null;
    const prevStart = resets.length > 1 ? resets[resets.length - 2] : null;
    const [current, previous] = await Promise.all([
      getPlayerMatches(playerName, { ...filters, since: start, limit: TRACK_ROW_CAP }),
      start
        ? getPlayerMatches(playerName, { ...filters, since: prevStart, until: start, limit: TRACK_ROW_CAP })
        : Promise.resolve([] as DbMatch[]),
    ]);
    return {
      current,
      previous: previous.length ? previous : null,
      truncated: current.length === TRACK_ROW_CAP,
      compare: "last season",
    };
  }
  const current = await getPlayerMatches(playerName, { ...filters, limit: TRACK_ROW_CAP });
  return { current, previous: null, truncated: current.length === TRACK_ROW_CAP, compare: null };
}

/**
 * The scoreboard rating of lib/match-stats.ts performanceRating(), per row, in
 * SQL (`rr` = the round count). Kept equal to the JavaScript by a test.
 */
export const RATING_SQL = `ROUND(CASE
  WHEN rr > 0 THEN MIN(2.5, MAX(0.2,
    0.95 * COALESCE(kills, 0) * 1.0 / rr + 0.28 * COALESCE(assists, 0) * 1.0 / rr
    - 0.38 * COALESCE(deaths, 0) * 1.0 / rr + 0.35 * COALESCE(mvps, 0) * 1.0 / rr
    + 0.04 * (COALESCE(points, 0) * 1.0 / rr) / 2.5 + 0.58))
  ELSE MIN(2.5, MAX(0.2,
    0.45 * (CASE WHEN COALESCE(deaths, 0) > 0 THEN COALESCE(kills, 0) * 1.0 / deaths ELSE COALESCE(kills, 0) END)
    + 0.12 * (COALESCE(assists, 0) * 1.0 / MAX(COALESCE(deaths, 0), 1)) + 0.65))
END, 2)`;

/** Per-match averages of one skill tier this season (the Performance bars). */
export interface TierBenchmark {
  /** players.rank label, e.g. "[A3 | 1450-1649]". */
  rank: string;
  matches: number;
  winPercent: number;
  rating: number;
  kd: number;
  kr: number | null;
  adr: number | null;
  hsPercent: number;
  eloPerMatch: number;
  mvpsPerMatch: number;
  firstKillsPerMatch: number | null;
}

async function queryTierBenchmark(rank: string, since: string | null, maps: string[] | null): Promise<TierBenchmark | null> {
  const mapSql = maps?.length ? ` AND mh.map_name IN (${maps.map(() => "?").join(",")})` : "";
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS matches,
                 SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) AS wins,
                 SUM(COALESCE(kills, 0)) AS kills,
                 SUM(COALESCE(deaths, 0)) AS deaths,
                 SUM(COALESCE(mvps, 0)) AS mvps,
                 SUM(COALESCE(elo_change, 0)) AS elo,
                 AVG(COALESCE(hs_percentage, 0)) AS hs,
                 SUM(rr) AS rounds,
                 SUM(CASE WHEN rr IS NOT NULL THEN COALESCE(kills, 0) END) AS round_kills,
                 SUM(CASE WHEN rr IS NOT NULL AND damage IS NOT NULL THEN damage END) AS damage,
                 SUM(CASE WHEN rr IS NOT NULL AND damage IS NOT NULL THEN rr END) AS damage_rounds,
                 AVG(${RATING_SQL}) AS rating,
                 SUM(first_kills) AS fk,
                 COUNT(first_kills) AS fk_n
          FROM (
            SELECT mh.result, mh.kills, mh.deaths, mh.assists, mh.mvps, mh.points, mh.hs_percentage,
                   mh.elo_change, mh.damage, mh.first_kills, ${ROUNDS_SQL} AS rr
            FROM match_history mh JOIN players p ON p.name = mh.player_name
            WHERE p.rank = ? AND COALESCE(p.placement_done, 0) = 1
              AND COALESCE(mh.is_placement, 0) = 0 AND COALESCE(mh.is_test, 0) = 0
              AND mh.timestamp >= ?${mapSql}
          )`,
    args: [rank, since ?? "", ...(maps ?? [])],
  });
  const r = rs.rows[0] as unknown as Record<string, unknown> | undefined;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const matches = n(r?.matches);
  if (matches < BENCHMARK_MIN_MATCHES) return null;
  const deaths = n(r?.deaths);
  return {
    rank,
    matches,
    winPercent: (n(r?.wins) / matches) * 100,
    rating: n(r?.rating),
    kd: deaths > 0 ? n(r?.kills) / deaths : n(r?.kills),
    kr: n(r?.rounds) > 0 ? n(r?.round_kills) / n(r?.rounds) : null,
    adr: n(r?.damage_rounds) > 0 ? n(r?.damage) / n(r?.damage_rounds) : null,
    hsPercent: n(r?.hs),
    eloPerMatch: n(r?.elo) / matches,
    mvpsPerMatch: n(r?.mvps) / matches,
    firstKillsPerMatch: n(r?.fk_n) > 0 ? n(r?.fk) / n(r?.fk_n) : null,
  };
}

/** The tier's averages, cached for 10 minutes per tier, season and map filter. */
export function getTierBenchmark(rank: string, since: string | null, maps: string[] | null = null): Promise<TierBenchmark | null> {
  const key = `track-bench:${rank}:${since ?? ""}:${(maps ?? []).join("|")}`;
  return remember(key, 10 * 60_000, () => queryTierBenchmark(rank, since, maps)).catch(() => null);
}

/** When this season's peak Elo was reached (the first match that ended on it), or null. */
export async function getPeakTime(playerName: string, peakElo: number, since: string | null): Promise<string | null> {
  if (!peakElo) return null;
  try {
    const rs = await client.execute({
      sql: `SELECT timestamp FROM match_history
            WHERE ${PLAYER_ROWS} AND COALESCE(is_placement, 0) = 0 AND COALESCE(is_test, 0) = 0
              AND elo_before IS NOT NULL AND elo_before + COALESCE(elo_change, 0) = ? AND timestamp >= ?
            ORDER BY id ASC LIMIT 1`,
      args: [playerName, playerName, peakElo, since ?? ""],
    });
    return rs.rows[0]?.timestamp ? String(rs.rows[0].timestamp) : null;
  } catch {
    return null;
  }
}
