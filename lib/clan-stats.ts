/**
 * Queries for the clan pages (docs/CLANS_UI_PLAN.md): members' rank and Elo,
 * matches played together (2+ members on one team), this season's records and
 * the list's card numbers. The pure helpers live in lib/clan-together.ts.
 */
import { client, ensurePlayerDiscordColumns, mapRank } from "@/lib/db";
import { averageElo, groupTogether, type TogetherRow } from "@/lib/clan-together";

export {
  averageElo,
  buildActivity,
  groupTogether,
  togetherCounts,
  type ClanEvent,
  type TogetherMatch,
  type TogetherRow,
} from "@/lib/clan-together";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** A member's linked player, for rank, Elo and a fallback avatar. */
export interface MemberPlayer {
  name: string;
  elo: number;
  rank: string;
  placementDone: boolean;
  avatar: string | null;
  /** ISO country code, lowercased, or null. */
  country: string | null;
}

/**
 * The players behind a list of members, keyed by Discord id (and by lowercased
 * name for members whose id isn't on the player row). One query.
 */
export async function memberPlayers(
  members: { discordId: string; playerName: string | null }[]
): Promise<{ byId: Map<string, MemberPlayer>; byName: Map<string, MemberPlayer> }> {
  const byId = new Map<string, MemberPlayer>();
  const byName = new Map<string, MemberPlayer>();
  const names = [...new Set(members.map((m) => (m.playerName || "").trim().toLowerCase()).filter(Boolean))];
  const ids = [...new Set(members.map((m) => m.discordId).filter(Boolean))];
  if (!names.length && !ids.length) return { byId, byName };
  await ensurePlayerDiscordColumns().catch(() => undefined);
  const where = [
    names.length ? `lower(name) IN (${names.map(() => "?").join(",")})` : "",
    ids.length ? `CAST(discord_id AS TEXT) IN (${ids.map(() => "?").join(",")})` : "",
  ].filter(Boolean);
  const rs = await client.execute({
    sql: `SELECT name, elo, rank, placement_done, discord_id, discord_avatar, country FROM players WHERE ${where.join(" OR ")}`,
    args: [...names, ...ids],
  });
  for (const row of rs.rows) {
    const placementDone = Number(row.placement_done) === 1;
    const p: MemberPlayer = {
      name: String(row.name),
      elo: placementDone ? Number(row.elo) || 0 : 0,
      rank: placementDone ? mapRank(String(row.rank ?? "")) : "UNRANKED",
      placementDone,
      avatar: row.discord_avatar ? String(row.discord_avatar) : null,
      country: row.country ? String(row.country).toLowerCase() : null,
    };
    byName.set(p.name.toLowerCase(), p);
    if (row.discord_id != null && row.discord_id !== "") byId.set(String(row.discord_id), p);
  }
  return { byId, byName };
}

/** The player for one member: by Discord id, then by name. */
export function playerFor(
  players: { byId: Map<string, MemberPlayer>; byName: Map<string, MemberPlayer> },
  member: { discordId: string; playerName: string | null }
): MemberPlayer | null {
  return players.byId.get(member.discordId) ?? (member.playerName ? players.byName.get(member.playerName.toLowerCase()) : undefined) ?? null;
}

const RANKED = "COALESCE(is_placement, 0) = 0";

/** Ranked match_history rows of these players since `since` (newest first, capped). */
export async function togetherRows(playerNames: string[], since: string | null): Promise<TogetherRow[]> {
  if (playerNames.length < 2) return [];
  const LINE = ", kills, deaths, assists, mvps, points, rounds_played, elo_before";
  const sql = (cols: string, notTest: string) => `
    SELECT match_id, team, result, timestamp, map_name, round_score, player_name, elo_change${cols}
    FROM match_history
    WHERE player_name IN (${playerNames.map(() => "?").join(",")})
      AND timestamp >= ? AND match_id IS NOT NULL AND ${RANKED} ${notTest}
    ORDER BY id DESC LIMIT 5000`;
  const args = [...playerNames, since ?? ""];
  // Older databases miss the scoreboard columns or is_test: drop them in that order.
  let rows;
  for (const [cols, notTest] of [
    [LINE, "AND COALESCE(is_test, 0) = 0"],
    ["", "AND COALESCE(is_test, 0) = 0"],
    ["", ""],
  ]) {
    try {
      rows = (await client.execute({ sql: sql(cols, notTest), args })).rows;
      break;
    } catch (e) {
      if (!notTest) throw e;
    }
  }
  const num = (v: unknown) => (v == null ? undefined : Number(v) || 0);
  return (rows ?? []).map((r) => ({
    matchId: r.match_id == null ? null : Number(r.match_id),
    team: r.team == null ? null : Number(r.team),
    result: String(r.result) === "W" ? "W" : "L",
    timestamp: String(r.timestamp ?? ""),
    map: r.map_name == null ? null : String(r.map_name),
    roundScore: r.round_score == null ? null : String(r.round_score),
    player: String(r.player_name),
    eloChange: Number(r.elo_change) || 0,
    kills: num(r.kills),
    deaths: num(r.deaths),
    assists: num(r.assists),
    mvps: num(r.mvps),
    points: num(r.points),
    roundsPlayed: r.rounds_played == null ? null : Number(r.rounds_played),
    eloBefore: r.elo_before == null ? null : Number(r.elo_before),
  }));
}

export interface SeasonRecord {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
}

/** Each player's ranked matches, wins, kills and deaths since `since` (keys lowercased). */
export async function seasonRecords(playerNames: string[], since: string | null): Promise<Map<string, SeasonRecord>> {
  const out = new Map<string, SeasonRecord>();
  if (!playerNames.length) return out;
  const sql = (notTest: string) => `
    SELECT player_name, COUNT(*) AS matches, SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) AS wins,
           SUM(COALESCE(kills, 0)) AS kills, SUM(COALESCE(deaths, 0)) AS deaths
    FROM match_history
    WHERE player_name IN (${playerNames.map(() => "?").join(",")}) AND timestamp >= ? AND ${RANKED} ${notTest}
    GROUP BY player_name`;
  const args = [...playerNames, since ?? ""];
  let rows;
  try {
    rows = (await client.execute({ sql: sql("AND COALESCE(is_test, 0) = 0"), args })).rows;
  } catch {
    rows = (await client.execute({ sql: sql(""), args })).rows;
  }
  for (const r of rows) {
    out.set(String(r.player_name).toLowerCase(), {
      matches: Number(r.matches) || 0,
      wins: Number(r.wins) || 0,
      kills: Number(r.kills) || 0,
      deaths: Number(r.deaths) || 0,
    });
  }
  return out;
}

/** What a clan card shows (GET /api/clubs). */
export interface ClanListStats {
  /** The first members by role: name and avatar. */
  preview: { name: string; avatar: string | null }[];
  ranked: number;
  avgElo: number;
  avgRank: string;
  /** Times (UTC) of the matches together in the last 7 days, newest first. */
  week: string[];
}

const LIST_DAYS = 7;

/**
 * Card numbers for every clan: one players query and one match_history query
 * for all of them. `members` must already be in display order (owner first).
 */
export async function clanListStats(
  clubs: { id: string; members: { discordId: string; playerName: string | null; username: string; avatar: string | null }[] }[],
  now = Date.now()
): Promise<Map<string, ClanListStats>> {
  const all = clubs.flatMap((c) => c.members);
  const players = await memberPlayers(all).catch(() => ({ byId: new Map(), byName: new Map() }));
  const nameOf = (m: { discordId: string; playerName: string | null }) => playerFor(players, m)?.name ?? m.playerName;
  const names = [...new Set(all.map(nameOf).filter((n): n is string => !!n))];
  const since = new Date(now - LIST_DAYS * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const rows = await togetherRows(names, since).catch(() => []);
  const out = new Map<string, ClanListStats>();
  for (const club of clubs) {
    const mine = new Set(club.members.map(nameOf).filter((n): n is string => !!n).map((n) => n.toLowerCase()));
    const together = groupTogether(rows.filter((r) => mine.has(r.player.toLowerCase())));
    const resolved = club.members.map((m) => ({ m, p: playerFor(players, m) }));
    const average = averageElo(resolved.map(({ p }) => ({ elo: p?.elo ?? 0, placementDone: !!p?.placementDone })));
    out.set(club.id, {
      preview: resolved.slice(0, 5).map(({ m, p }) => ({ name: p?.name ?? m.playerName ?? m.username, avatar: m.avatar || p?.avatar || null })),
      ranked: average.ranked,
      avgElo: average.avg,
      avgRank: average.rank,
      week: together.map((t) => t.timestamp),
    });
  }
  return out;
}
