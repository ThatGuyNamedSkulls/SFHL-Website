/**
 * Queue ready checks (see the bot's core/ready_checks.py). When a queue fills,
 * the bot opens a check; players have 20 seconds to accept from Discord or
 * here. The website reads the check and records accepts; the bot decides.
 */
import { client } from "@/lib/db";

export type ReadyCheckStatus = "pending" | "started" | "failed" | "cancelled";

export interface MyReadyCheck {
  id: string;
  region: string;
  mode: string;
  status: ReadyCheckStatus;
  /** Milliseconds left to accept, measured on the server (clock-skew safe). */
  remainingMs: number;
  total: number;
  accepted: number;
  iAccepted: boolean;
  /** True when the check failed and this player was removed from the queue. */
  iWasRemoved: boolean;
}

/** How long after a check ends the website still reports its outcome. */
const RECENT_MS = 60_000;

let schemaReady: Promise<void> | null = null;

/** Same definitions as core/ready_checks.py. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS ready_checks (
           id TEXT PRIMARY KEY,
           region TEXT NOT NULL,
           mode TEXT NOT NULL,
           player_ids TEXT NOT NULL,
           deadline INTEGER NOT NULL,
           status TEXT NOT NULL,
           declined_ids TEXT,
           created_at INTEGER NOT NULL,
           finished_at INTEGER
         )`
      );
      await client.execute(
        `CREATE TABLE IF NOT EXISTS ready_check_accepts (
           check_id TEXT NOT NULL,
           discord_id TEXT NOT NULL,
           accepted_at INTEGER NOT NULL,
           PRIMARY KEY (check_id, discord_id)
         )`
      );
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

function ids(raw: unknown): string[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** The signed-in player's current (or just-finished) ready check. */
export async function myReadyCheck(discordId: string): Promise<MyReadyCheck | null> {
  await ensureSchema();
  const now = Date.now();
  const rs = await client.execute({
    sql: `SELECT id, region, mode, player_ids, deadline, status, declined_ids
          FROM ready_checks
          WHERE player_ids LIKE ? AND (status = 'pending' OR COALESCE(finished_at, created_at) > ?)
          ORDER BY created_at DESC LIMIT 1`,
    args: [`%"${discordId}"%`, now - RECENT_MS],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const players = ids(row.player_ids);
  if (!players.includes(discordId)) return null; // LIKE matched a longer id
  const acc = await client.execute({
    sql: "SELECT discord_id FROM ready_check_accepts WHERE check_id = ?",
    args: [String(row.id)],
  });
  const accepted = new Set(acc.rows.map((r) => String(r.discord_id)));
  return {
    id: String(row.id),
    region: String(row.region),
    mode: String(row.mode),
    status: String(row.status) as ReadyCheckStatus,
    remainingMs: Math.max(0, Number(row.deadline) - now),
    total: players.length,
    accepted: players.filter((p) => accepted.has(p)).length,
    iAccepted: accepted.has(discordId),
    iWasRemoved: ids(row.declined_ids).includes(discordId),
  };
}

export type AcceptResult = "accepted" | "already" | "not_in_check" | "closed" | "expired";

/** Record an accept from the website (same rules as the bot's accept()). */
export async function acceptReadyCheck(checkId: string, discordId: string): Promise<AcceptResult> {
  await ensureSchema();
  const rs = await client.execute({
    sql: "SELECT player_ids, deadline, status FROM ready_checks WHERE id = ?",
    args: [checkId],
  });
  const row = rs.rows[0];
  if (!row || String(row.status) !== "pending") return "closed";
  if (!ids(row.player_ids).includes(discordId)) return "not_in_check";
  if (Date.now() > Number(row.deadline)) return "expired";
  const ins = await client.execute({
    sql: `INSERT OR IGNORE INTO ready_check_accepts (check_id, discord_id, accepted_at)
          VALUES (?, ?, ?)`,
    args: [checkId, discordId, Date.now()],
  });
  return ins.rowsAffected > 0 ? "accepted" : "already";
}
