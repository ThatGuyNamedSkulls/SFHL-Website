import { createClient } from "@libsql/client";

// Ensure we have a database URL
if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is not set in environment variables");
}

export const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
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
  /** Discord @handle, synced from the guild by the bot (null until synced). */
  discord_username: string | null;
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
            placement_games_played, discord_username
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
                 placement_games_played, discord_username
          FROM players
          WHERE name = ?`,
    args: [name]
  });
  return (rs.rows[0] as unknown as DbPlayer) || undefined;
}

/** Record a player's Discord identity (called on login for the user's own row;
 *  the bot's hourly sync keeps everyone else fresh). */
export async function setPlayerDiscordIdentity(
  name: string,
  discordId: string,
  username: string
): Promise<void> {
  await ensurePlayerDiscordColumns();
  await client.execute({
    sql: "UPDATE players SET discord_id = ?, discord_username = ? WHERE name = ?",
    args: [discordId, username, name],
  });
}

export async function getPlayerCountry(name: string): Promise<string | null> {
  const rs = await client.execute({ sql: "SELECT country FROM players WHERE name = ?", args: [name] });
  if (rs.rows.length === 0) return null;
  return (rs.rows[0].country as string) || null;
}

export async function setPlayerCountry(name: string, code: string): Promise<boolean> {
  const rs = await client.execute({ sql: "UPDATE players SET country = ? WHERE name = ?", args: [code.toLowerCase(), name] });
  return rs.rowsAffected > 0;
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

/** Leaderboard positions by elo: overall, and within the player's country
 *  (null when they have no country set). */
export async function getPlayerRankings(
  name: string
): Promise<{ overall: number | null; country: number | null }> {
  const rs = await client.execute({
    sql: "SELECT elo, country FROM players WHERE name = ?",
    args: [name],
  });
  if (rs.rows.length === 0) return { overall: null, country: null };
  const elo = Number(rs.rows[0].elo);
  const ctry = (rs.rows[0].country as string) || null;

  const o = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM players WHERE elo > ?",
    args: [elo],
  });
  const overall = Number(o.rows[0].c) + 1;

  let country: number | null = null;
  if (ctry) {
    const c = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM players WHERE elo > ? AND LOWER(country) = LOWER(?)",
      args: [elo, ctry],
    });
    country = Number(c.rows[0].c) + 1;
  }
  return { overall, country };
}

/** The DB rank string for a brand-new (Elo 0) player — mirrors the bot's
 *  get_rank(0). Reverse of RANK_DB_MAP["[?] Unranked"]. */
const UNRANKED_DB_RANK = "[?] Unranked";

/**
 * Ensure a player row exists for this name, creating a fresh unranked one if
 * not (same shape the bot's /addplayer produces: Elo 0, everything else
 * defaulted). Returns the player row. Safe to call on every login.
 */
export async function ensurePlayer(name: string): Promise<DbPlayer | undefined> {
  const existing = await getPlayer(name);
  if (existing) return existing;
  await client.execute({
    sql: "INSERT OR IGNORE INTO players (name, elo, rank) VALUES (?, 0, ?)",
    args: [name, UNRANKED_DB_RANK],
  });
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
}

export async function getMatchesForPlayer(playerName: string): Promise<DbMatch[]> {
  const rs = await client.execute({
    sql: `SELECT id, player_name, map_name, region, kills, deaths, assists,
                 hs_percentage, elo_change, result, points, mvps, match_id,
                 timestamp, executed_by, round_score
          FROM match_history
          WHERE player_name = ?
          ORDER BY id DESC`,
    args: [playerName]
  });
  return rs.rows as unknown as DbMatch[];
}

export async function getMatchesByMatchId(matchId: number): Promise<DbMatch[]> {
  const rs = await client.execute({
    sql: `SELECT id, player_name, map_name, region, kills, deaths, assists,
                 hs_percentage, elo_change, result, points, mvps, match_id,
                 timestamp, executed_by, round_score
          FROM match_history
          WHERE match_id = ?
          ORDER BY points DESC`,
    args: [matchId]
  });
  return rs.rows as unknown as DbMatch[];
}

export async function getAllMatchIds(): Promise<{ match_id: number; timestamp: string; map_name: string; region: string }[]> {
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

export async function getMostPlayedWith(
  playerName: string,
  limit = 10
): Promise<{ name: string; count: number; discordUsername: string | null }[]> {
  try {
    const rs = await client.execute({
      sql: `SELECT other.player_name AS name, p.discord_username AS discordUsername, COUNT(*) AS count
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
    return rs.rows as unknown as { name: string; count: number; discordUsername: string | null }[];
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
}

export async function getWebQueue(): Promise<WebQueueEntry[]> {
  try {
    const rs = await client.execute("SELECT * FROM web_queue ORDER BY joined_at ASC");
    return rs.rows as unknown as WebQueueEntry[];
  } catch {
    return [];
  }
}

export async function joinWebQueue(
  discordUserId: string,
  discordUsername: string,
  playerName: string | null
): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS web_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      discord_username TEXT NOT NULL,
      player_name TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.execute({
    sql: `INSERT OR REPLACE INTO web_queue (discord_user_id, discord_username, player_name)
          VALUES (?, ?, ?)`,
    args: [discordUserId, discordUsername, playerName]
  });
}

export async function leaveWebQueue(discordUserId: string): Promise<void> {
  try {
    await client.execute({ sql: "DELETE FROM web_queue WHERE discord_user_id = ?", args: [discordUserId] });
  } catch {}
}

/** The bot's global queue format (team size), set by the /gamemode command
 *  (bot_state key 'queue_mode'). Defaults to 5 (5v5) when unset. */
export async function getQueueTeamSize(): Promise<number> {
  try {
    const rs = await client.execute(
      "SELECT value FROM bot_state WHERE key = 'queue_mode'"
    );
    const v = Number(rs.rows[0]?.value);
    return v === 1 ? 1 : 5;
  } catch {
    return 5; // bot_state table may not exist yet
  }
}

export async function isInWebQueue(discordUserId: string): Promise<boolean> {
  try {
    const rs = await client.execute({ sql: "SELECT 1 FROM web_queue WHERE discord_user_id = ?", args: [discordUserId] });
    return rs.rows.length > 0;
  } catch {
    return false;
  }
}
