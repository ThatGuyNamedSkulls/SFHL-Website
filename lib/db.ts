import { createClient, type Client, type ResultSet, type InArgs } from "@libsql/client";
import { isQueueRegion } from "@/lib/regions";
import { countryToPlayRegion } from "@/lib/country-regions";
import { MATCH_TEAM_SIZE } from "@/lib/match-mode";
import { parseQueueMode, type QueueModeId } from "@/lib/queue-modes";

// Ensure we have a database URL
if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is not set in environment variables");
}

/** Discord snowflakes (and other 64-bit ints) overflow JS numbers. Read them as
 *  bigint, then keep safe values as Number and oversized ones as strings so
 *  `getPlayer` / leaderboards don't 500. */
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function coerceValue(v: unknown): unknown {
  if (typeof v === "bigint") {
    return v >= MIN_SAFE_BIGINT && v <= MAX_SAFE_BIGINT ? Number(v) : v.toString();
  }
  return v;
}

function coerceResult(rs: ResultSet): ResultSet {
  const rows = rs.rows.map((row) => {
    // Plain object (not an Array): JSON.stringify drops named keys on arrays, which
    // crashed the profile page when `playedWith` rows lost `.name`.
    const next: Record<string | number, unknown> = {};
    for (let i = 0; i < rs.columns.length; i++) {
      const col = rs.columns[i];
      const val = coerceValue(row[i] ?? row[col]);
      next[i] = val;
      next[col] = val;
    }
    Object.defineProperty(next, "length", { value: rs.columns.length, enumerable: false });
    return next as (typeof rs.rows)[number];
  });
  return { ...rs, rows };
}

const rawClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: "bigint",
});

export const client: Client = new Proxy(rawClient, {
  get(target, prop, _receiver) {
    if (prop === "execute") {
      return async (stmt: Parameters<Client["execute"]>[0], args?: Parameters<Client["execute"]>[1]) => {
        const rs =
          typeof stmt === "string" ? await target.execute(stmt, args) : await target.execute(stmt);
        return coerceResult(rs);
      };
    }
    if (prop === "batch") {
      return async (...args: Parameters<Client["batch"]>) => {
        const results = await target.batch(...args);
        return results.map(coerceResult);
      };
    }
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
});

// ---------------------------------------------------------------------------
// Rank mapping: DB rank string → website tier letter
// ---------------------------------------------------------------------------

const RANK_DB_MAP: Record<string, string> = {
  "[D | 1-799]": "D",
  "[C | 800-949]": "C",
  "[B | 950-1099]": "B",
  "[A1 | 1100-1249]": "A1",
  "[A2 | 1250-1449]": "A2",
  "[A3 | 1450-1649]": "A3",
  "[S1 | 1650-1899]": "S1",
  "[S2 | 1900-2199]": "S2",
  "[S3 | 2200-2499]": "S3",
  "[★ | 2500+]": "STAR",
  "[?] Unranked": "UNRANKED",
};

export function mapRank(dbRank: string): string {
  return RANK_DB_MAP[dbRank] || "UNRANKED";
}

// ---------------------------------------------------------------------------
// Player queries
// ---------------------------------------------------------------------------

export interface DbPlayer {
  id: number;
  name: string;
  elo: number;
  rank: string;
  country: string | null;
  total_kills: number;
  total_deaths: number;
  total_assists: number;
  kd_ratio: number;
  total_mvps: number;
  total_score: number;
  total_headshot_percentage: number;
  avg_hs_percent: number;
  matches_played: number;
  matches_won: number;
  peak_elo: number;
  total_play_time: number;
  roblox_avatar_image: string | null;
  placement_done: number;
  placement_games_played: number;
  /** Discord snowflake, when the bot or a website login has linked this row. */
  discord_id: string | number | null;
  /** Discord @handle, synced from the guild by the bot (null until synced). */
  discord_username: string | null;
  /** Discord profile-picture URL, synced hourly by the bot. This is what the
   *  leaderboard/profile actually render: the bot's Roblox avatar files are
   *  local to its host and 404 on Vercel, which is why avatars degraded to
   *  initials there. Null until the bot's sync has run. */
  discord_avatar: string | null;
}

/** Lazily add the Discord-identity columns if the bot hasn't migrated them yet
 *  (idempotent; ignores "duplicate column"). Guards the SELECTs below so a
 *  pre-migration DB can't 500 the leaderboard/profile. */
let discordColsReady: Promise<void> | null = null;
export function ensurePlayerDiscordColumns(): Promise<void> {
  if (!discordColsReady) {
    discordColsReady = (async () => {
      await client.execute("ALTER TABLE players ADD COLUMN discord_id INTEGER DEFAULT NULL").catch(() => {});
      await client.execute("ALTER TABLE players ADD COLUMN discord_username TEXT DEFAULT NULL").catch(() => {});
      await client.execute("ALTER TABLE players ADD COLUMN discord_avatar TEXT DEFAULT NULL").catch(() => {});
      await client.execute("ALTER TABLE players ADD COLUMN country TEXT DEFAULT NULL").catch(() => {});
    })();
  }
  return discordColsReady;
}

export async function getAllPlayers(): Promise<DbPlayer[]> {
  await ensurePlayerDiscordColumns();
  const rs = await client.execute(
    `SELECT id, name, elo, rank, country, total_kills, total_deaths, total_assists,
            kd_ratio, total_mvps, total_score, total_headshot_percentage,
            avg_hs_percent, matches_played, matches_won, peak_elo,
            total_play_time, roblox_avatar_image, placement_done,
            placement_games_played, CAST(discord_id AS TEXT) AS discord_id,
            discord_username, discord_avatar
     FROM players
     ORDER BY elo DESC`
  );
  return rs.rows as unknown as DbPlayer[];
}

export async function getPlayer(name: string): Promise<DbPlayer | undefined> {
  await ensurePlayerDiscordColumns();
  const rs = await client.execute({
    sql: `SELECT id, name, elo, rank, country, total_kills, total_deaths, total_assists,
                 kd_ratio, total_mvps, total_score, total_headshot_percentage,
                 avg_hs_percent, matches_played, matches_won, peak_elo,
                 total_play_time, roblox_avatar_image, placement_done,
                 placement_games_played, CAST(discord_id AS TEXT) AS discord_id,
                 discord_username, discord_avatar
          FROM players
          WHERE name = ?`,
    args: [name]
  });
  return (rs.rows[0] as unknown as DbPlayer) || undefined;
}

/** Look up a player by Discord snowflake. New accounts are created by the bot
 *  only after Bloxlink verification — the website never inserts players. */
export async function getPlayerByDiscordId(discordId: string): Promise<DbPlayer | undefined> {
  await ensurePlayerDiscordColumns();
  const rs = await client.execute({
    sql: `SELECT id, name, elo, rank, country, total_kills, total_deaths, total_assists,
                 kd_ratio, total_mvps, total_score, total_headshot_percentage,
                 avg_hs_percent, matches_played, matches_won, peak_elo,
                 total_play_time, roblox_avatar_image, placement_done,
                 placement_games_played, CAST(discord_id AS TEXT) AS discord_id,
                 discord_username, discord_avatar
          FROM players
          WHERE CAST(discord_id AS TEXT) = ?`,
    args: [String(discordId)]
  });
  return (rs.rows[0] as unknown as DbPlayer) || undefined;
}

/** Record a player's Discord identity (called on login for the user's own row;
 *  the bot's hourly sync keeps everyone else fresh). */
export async function setPlayerDiscordIdentity(
  name: string,
  discordId: string,
  username: string,
  avatar?: string | null
): Promise<void> {
  await ensurePlayerDiscordColumns();
  if (avatar) {
    await client.execute({
      sql: "UPDATE players SET discord_id = ?, discord_username = ?, discord_avatar = ? WHERE name = ?",
      args: [discordId, username, avatar, name],
    });
  } else {
    await client.execute({
      sql: "UPDATE players SET discord_id = ?, discord_username = ? WHERE name = ?",
      args: [discordId, username, name],
    });
  }
}

function readCountry(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const raw = (row as Record<string, unknown>).country;
  const code = typeof raw === "string" ? raw.toLowerCase() : "";
  return code || null;
}

export async function getPlayerCountry(
  name: string,
  discordId?: string | null
): Promise<string | null> {
  await ensurePlayerDiscordColumns();
  if (discordId) {
    const byDiscord = await client.execute({
      sql: "SELECT country FROM players WHERE CAST(discord_id AS TEXT) = ?",
      args: [String(discordId)],
    });
    if (byDiscord.rows.length > 0) return readCountry(byDiscord.rows[0]);
  }
  const rs = await client.execute({
    sql: "SELECT country FROM players WHERE name = ?",
    args: [name],
  });
  if (rs.rows.length === 0) return null;
  return readCountry(rs.rows[0]);
}

export async function setPlayerCountry(
  name: string,
  code: string,
  discordId?: string | null
): Promise<boolean> {
  await ensurePlayerDiscordColumns();
  const normalized = code.toLowerCase();
  if (discordId) {
    const existing = await getPlayerByDiscordId(String(discordId));
    if (existing) {
      await client.execute({
        sql: "UPDATE players SET country = ? WHERE CAST(discord_id AS TEXT) = ?",
        args: [normalized, String(discordId)],
      });
      return true;
    }
  }
  const existing = await getPlayer(name);
  if (!existing) return false;
  await client.execute({
    sql: "UPDATE players SET country = ? WHERE name = ?",
    args: [normalized, name],
  });
  return true;
}

/** Lazily add the shop-currency column if the bot hasn't migrated it yet
 *  (idempotent; ignores the "duplicate column" error on already-migrated DBs). */
let coinsColumnReady: Promise<void> | null = null;
export function ensurePlayerCoinsColumn(): Promise<void> {
  if (!coinsColumnReady) {
    coinsColumnReady = client
      .execute("ALTER TABLE players ADD COLUMN coins INTEGER DEFAULT 0")
      .then(() => undefined)
      .catch(() => undefined); // already exists — fine
  }
  return coinsColumnReady;
}

/** A player's HL Coin balance (0 when unset / no such player). */
export async function getPlayerCoins(name: string): Promise<number> {
  await ensurePlayerCoinsColumn();
  const rs = await client.execute({ sql: "SELECT coins FROM players WHERE name = ?", args: [name] });
  return Number(rs.rows[0]?.coins ?? 0);
}

/** Leaderboard positions by elo: overall, within the player's country, and
 *  within the play region that country maps to (EU/NA/SA/APAC/OC). */
export async function getPlayerRankings(
  name: string
): Promise<{ overall: number | null; country: number | null; region: number | null }> {
  const rs = await client.execute({
    sql: "SELECT elo, country FROM players WHERE name = ?",
    args: [name],
  });
  if (rs.rows.length === 0) return { overall: null, country: null, region: null };
  const elo = Number(rs.rows[0].elo);
  const ctry = ((rs.rows[0].country as string) || "").toLowerCase() || null;
  const playRegion = countryToPlayRegion(ctry);

  const all = await client.execute("SELECT elo, country FROM players");
  let overall = 1;
  let country: number | null = ctry ? 1 : null;
  let region: number | null = playRegion ? 1 : null;
  for (const row of all.rows) {
    if (Number(row.elo) <= elo) continue;
    overall += 1;
    const rowCountry = ((row.country as string) || "").toLowerCase() || null;
    if (ctry && country !== null && rowCountry === ctry) country += 1;
    if (playRegion && region !== null && countryToPlayRegion(rowCountry) === playRegion) {
      region += 1;
    }
  }
  return { overall, country, region };
}

/** Look up a player by name. New rows are created by the Discord bot after
 *  Bloxlink verification, not here. */
export async function ensurePlayer(name: string): Promise<DbPlayer | undefined> {
  return getPlayer(name);
}

// ---------------------------------------------------------------------------
// Match history queries
// ---------------------------------------------------------------------------

export interface DbMatch {
  id: number;
  player_name: string;
  map_name: string | null;
  region: string | null;
  kills: number;
  deaths: number;
  assists: number;
  hs_percentage: number;
  elo_change: number;
  result: string;
  points: number;
  mvps: number;
  match_id: number | null;
  timestamp: string;
  executed_by: string | null;
  round_score: string | null;
  /** Side the player was on (1 = winners/team 1, 2 = losers/team 2). Written by
   *  the bot since the tie overhaul; null on older rows. */
  team: number | null;
  /** Gamemode ("5v5" / "2v2" / "1v1"); null on legacy rows (= main ladder). */
  mode?: string | null;
  /** 1 if this row is a substitute appearance. */
  is_sub?: number;
  /** 1 if this row is the player who left mid-match. */
  left_early?: number;
  /** Presence fraction of the match; null on a full-game row. */
  sub_share?: number | null;
  /** Rank at the time of this match (post-result). Null on legacy rows. */
  player_rank?: string | null;
  /** Elo the player had when this match started. Null on legacy rows. */
  elo_before?: number | null;
}

const MATCH_BASE_COLS = `id, player_name, map_name, region, kills, deaths, assists,
                 hs_percentage, elo_change, result, points, mvps, match_id,
                 timestamp, executed_by, round_score`;
const MATCH_SUB_COLS = `${MATCH_BASE_COLS}, COALESCE(is_sub, 0) AS is_sub, COALESCE(left_early, 0) AS left_early, sub_share`;
const MATCH_RANK_COLS = `${MATCH_SUB_COLS}, player_rank`;
const MATCH_ELO_COLS = `${MATCH_RANK_COLS}, elo_before`;

async function selectMatchRows(whereSql: string, args: InArgs): Promise<DbMatch[]> {
  const variants = [MATCH_ELO_COLS, MATCH_RANK_COLS, MATCH_SUB_COLS, MATCH_BASE_COLS];
  let lastErr: unknown;
  for (const cols of variants) {
    try {
      const rs = await client.execute({
        sql: `SELECT ${cols} ${whereSql}`,
        args,
      });
      return rs.rows as unknown as DbMatch[];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function getMatchesForPlayer(playerName: string, limit = 100): Promise<DbMatch[]> {
  // Exclude placement games (is_placement=1): they don't count toward stats, so
  // they're kept out of the profile match list, the region tally, and the ELO
  // graph — the graph then starts at the player's post-placement ELO instead of
  // reconstructing the 0 → 0 → 0 → <graduation ELO> placement climb. COALESCE
  // covers legacy rows written before the column existed. Mirrors the bot's
  // /matchhistory + /checkperformance filters. Dummy /rankdummies rows are
  // hidden unless staff passed history=True (is_test=0).
  const where =
    "FROM match_history WHERE player_name = ? AND COALESCE(is_placement, 0) = 0";
  try {
    return await selectMatchRows(
      `${where} AND COALESCE(is_test, 0) = 0 ORDER BY id DESC LIMIT ?`,
      [playerName, limit]
    );
  } catch {
    return selectMatchRows(`${where} ORDER BY id DESC LIMIT ?`, [playerName, limit]);
  }
}

/** Placement (pre-rank) games, oldest first — used by the profile placement track. */
export async function getPlacementMatchesForPlayer(playerName: string): Promise<DbMatch[]> {
  try {
    const rs = await client.execute({
      sql: `SELECT id, player_name, map_name, region, kills, deaths, assists,
                   hs_percentage, elo_change, result, points, mvps, match_id,
                   timestamp, executed_by, round_score
            FROM match_history
            WHERE player_name = ? AND COALESCE(is_placement, 0) = 1
            ORDER BY id ASC`,
      args: [playerName],
    });
    return rs.rows as unknown as DbMatch[];
  } catch {
    return [];
  }
}

/** Just the Elo deltas of a player's non-placement matches (newest first,
 *  capped) — enough to draw the profile Elo curve without hydrating every
 *  column of every match. Timestamps come along so the curve can be split at
 *  season-reset boundaries (see buildEloTimeline). */
export async function getEloChanges(
  playerName: string,
  limit = 250
): Promise<{ eloChange: number; timestamp: string }[]> {
  const sql =
    `SELECT elo_change, timestamp FROM match_history
          WHERE player_name = ? AND COALESCE(is_placement, 0) = 0
            AND COALESCE(is_test, 0) = 0
          ORDER BY id DESC
          LIMIT ?`;
  let rs;
  try {
    rs = await client.execute({ sql, args: [playerName, limit] });
  } catch {
    rs = await client.execute({
      sql: `SELECT elo_change, timestamp FROM match_history
            WHERE player_name = ? AND COALESCE(is_placement, 0) = 0
            ORDER BY id DESC LIMIT ?`,
      args: [playerName, limit],
    });
  }
  return rs.rows.map((r) => ({
    eloChange: Number(r.elo_change ?? 0),
    timestamp: (r.timestamp as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Season boundaries (season_resets + season_stats)
// ---------------------------------------------------------------------------

export interface SeasonReset {
  season_name: string;
  /** UTC "YYYY-MM-DD HH:MM:SS" — same format as match_history.timestamp. */
  reset_at: string;
}

/** Every season reset the bot has performed, oldest first. */
export async function getSeasonResets(): Promise<SeasonReset[]> {
  try {
    const rs = await client.execute(
      "SELECT season_name, reset_at FROM season_resets ORDER BY reset_at ASC"
    );
    return rs.rows as unknown as SeasonReset[];
  } catch {
    return []; // table not created yet (bot hasn't run the migration)
  }
}

/** A player's archived FINAL Elo for each past season (from /resetdb's
 *  season_stats archive) — the anchor each past season's curve is drawn back
 *  from, so history keeps its real values instead of being reconstructed from
 *  the post-reset Elo (which sent it negative). */
export async function getSeasonFinalElos(
  playerName: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rs = await client.execute({
      sql: "SELECT season_name, elo FROM season_stats WHERE player_name = ?",
      args: [playerName],
    });
    for (const r of rs.rows) {
      out.set(r.season_name as string, Number(r.elo ?? 0));
    }
  } catch {
    /* table not created yet */
  }
  return out;
}

/** Lifetime match count (placements included). Survives /seasonreset. */
export async function getCareerMatchCount(playerName: string): Promise<number> {
  try {
    const rs = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM match_history WHERE player_name = ?",
      args: [playerName],
    });
    return Number(rs.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Most recently archived season for a player (the one /seasonreset just ended). */
export async function getLastSeasonArchive(
  playerName: string
): Promise<{ season_name: string; elo: number; rank: string } | null> {
  try {
    const rs = await client.execute({
      sql: `SELECT season_name, elo, rank FROM season_stats
            WHERE player_name = ?
            ORDER BY archived_at DESC
            LIMIT 1`,
      args: [playerName],
    });
    const row = rs.rows[0];
    if (!row) return null;
    return {
      season_name: String(row.season_name ?? ""),
      elo: Number(row.elo ?? 0),
      rank: String(row.rank || "[?] Unranked"),
    };
  } catch {
    return null;
  }
}

export async function getMatchesByMatchId(matchId: number): Promise<DbMatch[]> {
  // COALESCE(team, ...) keeps this working on DBs from before the bot added
  // the team column (it backfills via ALTER, but a not-yet-restarted bot
  // means the column may not exist — fall back to a team-less select).
  const variants = [
    `${MATCH_ELO_COLS}, team, mode`,
    `${MATCH_RANK_COLS}, team, mode`,
    `${MATCH_SUB_COLS}, team, mode`,
    `${MATCH_BASE_COLS}, NULL AS team, NULL AS mode`,
  ];
  let lastErr: unknown;
  for (const cols of variants) {
    try {
      const rs = await client.execute({
        sql: `SELECT ${cols}
              FROM match_history
              WHERE match_id = ?
              ORDER BY points DESC`,
        args: [matchId],
      });
      return rs.rows as unknown as DbMatch[];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Per-mode rating ladders (mode_ratings — own-ladder gamemodes, e.g. 1v1)
// ---------------------------------------------------------------------------

export interface DbModeRating {
  mode: string;
  elo: number;
  rank: string;
  peak_elo: number;
  matches_played: number;
  matches_won: number;
  placement_done: number;
  placement_games_played: number;
}

/** A player's own-ladder ratings (e.g. their separate 1v1 rank), if any. */
export async function getModeRatings(playerName: string): Promise<DbModeRating[]> {
  try {
    const rs = await client.execute({
      sql: `SELECT mode, elo, rank, peak_elo, matches_played, matches_won,
                   placement_done, placement_games_played
            FROM mode_ratings WHERE player_name = ? ORDER BY mode`,
      args: [playerName],
    });
    return rs.rows as unknown as DbModeRating[];
  } catch {
    return []; // table not created yet (bot hasn't run the MMR v2 schema)
  }
}

/** Leaderboard for an own-ladder mode (players with a graduated rating first,
 *  by Elo; still-placing players excluded). Joined with players for avatars. */
export async function getModeLeaderboard(
  mode: string
): Promise<(DbModeRating & { player_name: string; roblox_avatar_image: string | null; country: string | null; discord_username: string | null; discord_avatar: string | null; discord_id: string | number | null })[]> {
  try {
    const rs = await client.execute({
      sql: `SELECT mr.player_name, mr.mode, mr.elo, mr.rank, mr.peak_elo,
                   mr.matches_played, mr.matches_won, mr.placement_done,
                   mr.placement_games_played,
                   p.roblox_avatar_image, p.country, p.discord_username, p.discord_avatar,
                   CAST(p.discord_id AS TEXT) AS discord_id
            FROM mode_ratings mr
            JOIN players p ON p.name = mr.player_name
            WHERE mr.mode = ? AND mr.placement_done = 1
            ORDER BY mr.elo DESC`,
      args: [mode],
    });
    return rs.rows as unknown as (DbModeRating & {
      player_name: string;
      roblox_avatar_image: string | null;
      country: string | null;
      discord_username: string | null;
      discord_avatar: string | null;
      discord_id: string | number | null;
    })[];
  } catch {
    return [];
  }
}

/** The bot's configured number of placement games (bot_state key
 *  'placement_games', written on startup). Defaults to 3. */
export async function getPlacementGamesTotal(): Promise<number> {
  try {
    const rs = await client.execute(
      "SELECT value FROM bot_state WHERE key = 'placement_games'"
    );
    const v = Number(rs.rows[0]?.value);
    return Number.isInteger(v) && v >= 1 ? v : 3;
  } catch {
    return 3; // bot_state table may not exist yet
  }
}

export async function getAllMatchIds(): Promise<{ match_id: number; timestamp: string; map_name: string; region: string }[]> {
  const sql = `SELECT DISTINCT match_id,
            MIN(timestamp) as timestamp,
            map_name,
            region
     FROM match_history
     WHERE match_id IS NOT NULL AND COALESCE(is_test, 0) = 0
     GROUP BY match_id
     ORDER BY MIN(timestamp) DESC`;
  try {
    const rs = await client.execute(sql);
    return rs.rows as unknown as { match_id: number; timestamp: string; map_name: string; region: string }[];
  } catch {
    const rs = await client.execute(
      `SELECT DISTINCT match_id,
              MIN(timestamp) as timestamp,
              map_name,
              region
       FROM match_history
       WHERE match_id IS NOT NULL
       GROUP BY match_id
       ORDER BY MIN(timestamp) DESC`
    );
    return rs.rows as unknown as { match_id: number; timestamp: string; map_name: string; region: string }[];
  }
}

export async function getMostPlayedWith(
  playerName: string,
  limit = 10
): Promise<{
  name: string;
  count: number;
  discordUsername: string | null;
  roblox_avatar_image: string | null;
  discord_avatar: string | null;
  discord_id: string | null;
}[]> {
  try {
    const rs = await client.execute({
      sql: `SELECT other.player_name AS name,
                   p.discord_username AS discordUsername,
                   p.roblox_avatar_image AS roblox_avatar_image,
                   p.discord_avatar AS discord_avatar,
                   CAST(p.discord_id AS TEXT) AS discord_id,
                   COUNT(*) AS count
            FROM match_history me
            JOIN match_history other
              ON me.match_id = other.match_id
             AND other.player_name <> me.player_name
            LEFT JOIN players p ON other.player_name = p.name
            WHERE me.player_name = ?
              AND me.match_id IS NOT NULL
            GROUP BY other.player_name
            ORDER BY count DESC
            LIMIT ?`,
      args: [playerName, limit]
    });
    return rs.rows
      .map((r) => ({
        name: String(r.name ?? ""),
        count: Number(r.count ?? 0),
        discordUsername: (r.discordUsername as string) ?? null,
        roblox_avatar_image: (r.roblox_avatar_image as string) ?? null,
        discord_avatar: (r.discord_avatar as string) ?? null,
        discord_id: (r.discord_id as string) ?? null,
      }))
      .filter((r) => r.name);
  } catch {
    return [];
  }
}

export async function getPlayerRegions(): Promise<Record<string, string>> {
  try {
    const rs = await client.execute(
      `SELECT player_name, region, COUNT(*) AS c
       FROM match_history
       WHERE region IS NOT NULL AND region <> ''
       GROUP BY player_name, region`
    );

    const best: Record<string, string> = {};
    const bestCount: Record<string, number> = {};
    for (const row of rs.rows) {
      const player_name = row.player_name as string;
      const region = row.region as string;
      const c = Number(row.c);
      
      if (bestCount[player_name] === undefined || c > bestCount[player_name]) {
        best[player_name] = region;
        bestCount[player_name] = c;
      }
    }
    return best;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

export interface AggregateStats {
  totalPlayers: number;
  totalMatches: number;
  totalKills: number;
  totalMatchRows: number;
  maps: string[];
}

export async function getAggregateStats(): Promise<AggregateStats> {
  const playerCount = await client.execute("SELECT COUNT(*) as count FROM players");
  const matchCount = await client.execute("SELECT COUNT(DISTINCT match_id) as count FROM match_history WHERE match_id IS NOT NULL");
  const totalKills = await client.execute("SELECT SUM(total_kills) as total FROM players");
  const totalRows = await client.execute("SELECT COUNT(*) as count FROM match_history");
  const maps = await client.execute("SELECT DISTINCT map_name FROM match_history WHERE map_name IS NOT NULL");

  return {
    totalPlayers: Number(playerCount.rows[0].count) || 0,
    totalMatches: Number(matchCount.rows[0].count) || 0,
    totalKills: Number(totalKills.rows[0].total) || 0,
    totalMatchRows: Number(totalRows.rows[0].count) || 0,
    maps: maps.rows.map((m) => m.map_name as string),
  };
}

// ---------------------------------------------------------------------------
// Web queue operations (read-write)
// ---------------------------------------------------------------------------

export interface WebQueueEntry {
  id: number;
  discord_user_id: string;
  discord_username: string;
  player_name: string | null;
  joined_at: string;
  region?: string | null;
  queue_mode?: string | null;
}

let webQueueModeReady: Promise<void> | null = null;
export function ensureWebQueueModeColumn(): Promise<void> {
  if (!webQueueModeReady) {
    webQueueModeReady = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS web_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_user_id TEXT NOT NULL UNIQUE,
          discord_username TEXT NOT NULL,
          player_name TEXT,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          region TEXT,
          queue_mode TEXT
        )
      `);
      await client.execute("ALTER TABLE web_queue ADD COLUMN region TEXT").catch(() => {});
      await client.execute("ALTER TABLE web_queue ADD COLUMN queue_mode TEXT").catch(() => {});
    })();
  }
  return webQueueModeReady;
}

export async function getWebQueue(region?: string): Promise<WebQueueEntry[]> {
  try {
    await ensureWebQueueModeColumn();
    if (region) {
      const rs = await client.execute({
        sql: "SELECT * FROM web_queue WHERE region = ? ORDER BY joined_at ASC",
        args: [region],
      });
      return rs.rows as unknown as WebQueueEntry[];
    }
    const rs = await client.execute("SELECT * FROM web_queue ORDER BY joined_at ASC");
    return rs.rows as unknown as WebQueueEntry[];
  } catch {
    return [];
  }
}

export async function joinWebQueue(
  discordUserId: string,
  discordUsername: string,
  playerName: string | null,
  region: string,
  mode: QueueModeId = "standard"
): Promise<void> {
  await ensureWebQueueModeColumn();
  await client.execute({
    sql: `INSERT OR REPLACE INTO web_queue (discord_user_id, discord_username, player_name, region, queue_mode)
          VALUES (?, ?, ?, ?, ?)`,
    args: [discordUserId, discordUsername, playerName, region, mode]
  });
}

export async function leaveWebQueue(discordUserId: string): Promise<void> {
  try {
    await client.execute({ sql: "DELETE FROM web_queue WHERE discord_user_id = ?", args: [discordUserId] });
  } catch {}
}

/** Live queue format. */
export async function getQueueTeamSize(): Promise<number> {
  return MATCH_TEAM_SIZE;
}

export async function isInWebQueue(discordUserId: string): Promise<boolean> {
  try {
    const rs = await client.execute({ sql: "SELECT 1 FROM web_queue WHERE discord_user_id = ?", args: [discordUserId] });
    return rs.rows.length > 0;
  } catch {
    return false;
  }
}

/** Which region queue this Discord user is waiting in, if any. */
export async function getWebQueueRegion(discordUserId: string): Promise<string | null> {
  const spot = await getWebQueueSpot(discordUserId);
  return spot?.region ?? null;
}

export async function getWebQueueSpot(
  discordUserId: string
): Promise<{ region: string; mode: QueueModeId } | null> {
  try {
    await ensureWebQueueModeColumn();
    const rs = await client.execute({
      sql: "SELECT region, queue_mode FROM web_queue WHERE discord_user_id = ?",
      args: [discordUserId],
    });
    if (!rs.rows.length) return null;
    const raw = String(rs.rows[0].region ?? "").toUpperCase();
    if (!isQueueRegion(raw)) return null;
    return { region: raw, mode: parseQueueMode(rs.rows[0].queue_mode) };
  } catch {
    return null;
  }
}

/** Whether Match Staff currently have one or more region queues open in Discord. */
export async function getQueueGate(): Promise<{
  open: boolean;
  region: string | null;
  openRegions: string[];
  openModes: Record<string, QueueModeId[]>;
}> {
  try {
    const rs = await client.execute(
      "SELECT key, value FROM bot_state WHERE key IN ('queue_open_regions', 'queue_open', 'queue_region', 'queue_open_modes')"
    );
    let openRegions: string[] = [];
    let legacyOpen = false;
    let legacyRegion: string | null = null;
    let openModes: Record<string, QueueModeId[]> = {};
    for (const row of rs.rows) {
      const key = String(row.key);
      const value = String(row.value ?? "");
      if (key === "queue_open_regions" && value) {
        openRegions = value
          .split(",")
          .map((part) => part.trim().toUpperCase())
          .filter((part) => isQueueRegion(part));
      }
      if (key === "queue_open") legacyOpen = value === "1";
      if (key === "queue_region" && value) legacyRegion = value.toUpperCase();
      if (key === "queue_open_modes" && value) {
        for (const part of value.split(",")) {
          const [codeRaw, modeRaw] = part.split(":");
          const code = (codeRaw || "").trim().toUpperCase();
          const mode = parseQueueMode((modeRaw || "").trim());
          if (!isQueueRegion(code)) continue;
          const list = openModes[code] ?? [];
          if (!list.includes(mode)) list.push(mode);
          openModes[code] = list;
        }
      }
    }
    if (!openRegions.length && legacyOpen && legacyRegion && isQueueRegion(legacyRegion)) {
      openRegions = [legacyRegion];
    }
    if (openRegions.length && !Object.keys(openModes).length) {
      openModes = Object.fromEntries(
        openRegions.map((code) => [code, ["standard", "super"] as QueueModeId[]])
      );
    }
    return {
      open: openRegions.length > 0,
      region: openRegions[0] ?? null,
      openRegions,
      openModes,
    };
  } catch {
    return { open: false, region: null, openRegions: [], openModes: {} };
  }
}
