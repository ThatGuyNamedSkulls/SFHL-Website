/**
 * SQLite access layer for the SFHL website.
 *
 * Uses better-sqlite3 for synchronous, read-only access to the shared
 * player_database.db that the Discord bot also reads/writes.
 *
 * API routes call these helpers — the database is the single source of truth.
 */

import Database from "better-sqlite3";
import path from "path";

// Resolve DB path relative to the project root (hyperleague/) → ../../player_database.db
const DB_PATH =
  process.env.DATABASE_PATH ||
  path.resolve(process.cwd(), "..", "..", "player_database.db");

/** Get a read-only database connection. */
function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma("journal_mode = WAL");
  return db;
}

/** Get a read-write database connection (for queue operations). */
export function getDbReadWrite(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

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

// Ensure the (website-added) country column exists. Runs once per process,
// using a read-write connection; the ALTER is a no-op if it already exists.
let countryColumnEnsured = false;
function ensureCountryColumn(): void {
  if (countryColumnEnsured) return;
  try {
    const db = getDbReadWrite();
    try {
      db.exec("ALTER TABLE players ADD COLUMN country TEXT DEFAULT ''");
    } catch {
      // Column already exists — fine.
    } finally {
      db.close();
    }
  } catch {
    // DB not writable right now; try again next call.
    return;
  }
  countryColumnEnsured = true;
}

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
}

export function getAllPlayers(): DbPlayer[] {
  ensureCountryColumn();
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT id, name, elo, rank, country, total_kills, total_deaths, total_assists,
                kd_ratio, total_mvps, total_score, total_headshot_percentage,
                avg_hs_percent, matches_played, matches_won, peak_elo,
                total_play_time, roblox_avatar_image, placement_done,
                placement_games_played
         FROM players
         ORDER BY elo DESC`
      )
      .all() as DbPlayer[];
  } finally {
    db.close();
  }
}

export function getPlayer(name: string): DbPlayer | undefined {
  ensureCountryColumn();
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT id, name, elo, rank, country, total_kills, total_deaths, total_assists,
                kd_ratio, total_mvps, total_score, total_headshot_percentage,
                avg_hs_percent, matches_played, matches_won, peak_elo,
                total_play_time, roblox_avatar_image, placement_done,
                placement_games_played
         FROM players
         WHERE name = ?`
      )
      .get(name) as DbPlayer | undefined;
  } finally {
    db.close();
  }
}

/** Read a player's stored country code (lowercase alpha-2), or null. */
export function getPlayerCountry(name: string): string | null {
  ensureCountryColumn();
  const db = getDb();
  try {
    const row = db.prepare("SELECT country FROM players WHERE name = ?").get(name) as
      | { country: string | null }
      | undefined;
    return row?.country || null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Persist a player's country code. Returns false if the player doesn't exist. */
export function setPlayerCountry(name: string, code: string): boolean {
  ensureCountryColumn();
  const db = getDbReadWrite();
  try {
    const res = db
      .prepare("UPDATE players SET country = ? WHERE name = ?")
      .run(code.toLowerCase(), name);
    return res.changes > 0;
  } finally {
    db.close();
  }
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
  /** Match-level team round score, e.g. "13,11" (winners,losers). May be null on legacy rows. */
  round_score: string | null;
}

export function getMatchesForPlayer(playerName: string): DbMatch[] {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT id, player_name, map_name, region, kills, deaths, assists,
                hs_percentage, elo_change, result, points, mvps, match_id,
                timestamp, executed_by, round_score
         FROM match_history
         WHERE player_name = ?
         ORDER BY id DESC`
      )
      .all(playerName) as DbMatch[];
  } finally {
    db.close();
  }
}

export function getMatchesByMatchId(matchId: number): DbMatch[] {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT id, player_name, map_name, region, kills, deaths, assists,
                hs_percentage, elo_change, result, points, mvps, match_id,
                timestamp, executed_by, round_score
         FROM match_history
         WHERE match_id = ?
         ORDER BY points DESC`
      )
      .all(matchId) as DbMatch[];
  } finally {
    db.close();
  }
}

/** Get all distinct match IDs (for listing matches). */
export function getAllMatchIds(): { match_id: number; timestamp: string; map_name: string; region: string }[] {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT DISTINCT match_id,
                MIN(timestamp) as timestamp,
                map_name,
                region
         FROM match_history
         WHERE match_id IS NOT NULL
         GROUP BY match_id
         ORDER BY MIN(timestamp) DESC`
      )
      .all() as { match_id: number; timestamp: string; map_name: string; region: string }[];
  } finally {
    db.close();
  }
}

/**
 * Players this player has shared matches with most often (teammates or
 * opponents), derived from shared match_id values. Excludes the player.
 */
export function getMostPlayedWith(
  playerName: string,
  limit = 10
): { name: string; count: number }[] {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT other.player_name AS name, COUNT(*) AS count
           FROM match_history me
           JOIN match_history other
             ON me.match_id = other.match_id
            AND other.player_name <> me.player_name
          WHERE me.player_name = ?
            AND me.match_id IS NOT NULL
          GROUP BY other.player_name
          ORDER BY count DESC
          LIMIT ?`
      )
      .all(playerName, limit) as { name: string; count: number }[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * Each player's dominant match region (the server region they play on most
 * often), derived from match_history. Returns a name → raw-region map.
 */
export function getPlayerRegions(): Record<string, string> {
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT player_name, region, COUNT(*) AS c
           FROM match_history
          WHERE region IS NOT NULL AND region <> ''
          GROUP BY player_name, region`
      )
      .all() as { player_name: string; region: string; c: number }[];

    const best: Record<string, string> = {};
    const bestCount: Record<string, number> = {};
    for (const row of rows) {
      if (bestCount[row.player_name] === undefined || row.c > bestCount[row.player_name]) {
        best[row.player_name] = row.region;
        bestCount[row.player_name] = row.c;
      }
    }
    return best;
  } catch {
    return {};
  } finally {
    db.close();
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

export function getAggregateStats(): AggregateStats {
  const db = getDb();
  try {
    const playerCount = db
      .prepare("SELECT COUNT(*) as count FROM players")
      .get() as { count: number };

    const matchCount = db
      .prepare("SELECT COUNT(DISTINCT match_id) as count FROM match_history WHERE match_id IS NOT NULL")
      .get() as { count: number };

    const totalKills = db
      .prepare("SELECT SUM(total_kills) as total FROM players")
      .get() as { total: number };

    const totalRows = db
      .prepare("SELECT COUNT(*) as count FROM match_history")
      .get() as { count: number };

    const maps = db
      .prepare("SELECT DISTINCT map_name FROM match_history WHERE map_name IS NOT NULL")
      .all() as { map_name: string }[];

    return {
      totalPlayers: playerCount.count,
      totalMatches: matchCount.count,
      totalKills: totalKills.total || 0,
      totalMatchRows: totalRows.count,
      maps: maps.map((m) => m.map_name),
    };
  } finally {
    db.close();
  }
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

export function getWebQueue(): WebQueueEntry[] {
  const db = getDb();
  try {
    return db
      .prepare("SELECT * FROM web_queue ORDER BY joined_at ASC")
      .all() as WebQueueEntry[];
  } catch {
    // Table may not exist yet
    return [];
  } finally {
    db.close();
  }
}

export function joinWebQueue(
  discordUserId: string,
  discordUsername: string,
  playerName: string | null
): void {
  const db = getDbReadWrite();
  try {
    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS web_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL UNIQUE,
        discord_username TEXT NOT NULL,
        player_name TEXT,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.prepare(
      `INSERT OR REPLACE INTO web_queue (discord_user_id, discord_username, player_name)
       VALUES (?, ?, ?)`
    ).run(discordUserId, discordUsername, playerName);
  } finally {
    db.close();
  }
}

export function leaveWebQueue(discordUserId: string): void {
  const db = getDbReadWrite();
  try {
    db.prepare("DELETE FROM web_queue WHERE discord_user_id = ?").run(
      discordUserId
    );
  } catch {
    // Table may not exist
  } finally {
    db.close();
  }
}

export function isInWebQueue(discordUserId: string): boolean {
  const db = getDb();
  try {
    const row = db
      .prepare("SELECT 1 FROM web_queue WHERE discord_user_id = ?")
      .get(discordUserId);
    return !!row;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
