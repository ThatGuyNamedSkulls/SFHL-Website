/**
 * HL Coin ledger: every coin movement the website makes has a unique key.
 *
 * `coin_ledger.key` is the primary key, so a key can be applied at most once:
 * a second attempt fails the whole batch it's in (libsql batches are one
 * transaction). That is what stops parallel requests from paying the same
 * refund / prize / reward twice (docs/WEBSITE_SECURITY_REPORT.md H2).
 *
 * Key shapes: `cup:<tid>:refund:<teamUuid>`, `cup:<tid>:reqrefund:<requestId>`,
 * `cup:<tid>:prize:<teamUuid>`, `cup:<tid>:fee:<uuid>`, `mission:<player>:<missionId>`.
 */
import { randomUUID } from "crypto";
import type { InValue } from "@libsql/client";
import { client, ensurePlayerCoinsColumn } from "@/lib/db";
import { schemaOnce } from "@/lib/schema-once";

export type Stmt = { sql: string; args: InValue[] };

export interface CoinMove {
  key: string;
  playerName: string;
  delta: number;
  reason: string;
}

/** A SQL condition (and its args) that must hold for a move to apply. */
export interface Gate {
  sql: string;
  args: InValue[];
}

const ensureLedgerTable = schemaOnce("coin_ledger", async () => {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS coin_ledger (
         key TEXT PRIMARY KEY,
         player_name TEXT NOT NULL,
         player_id INTEGER,
         delta INTEGER NOT NULL,
         reason TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
      "CREATE INDEX IF NOT EXISTS idx_coin_ledger_player ON coin_ledger (player_name, created_at)",
    ],
    "write"
  );
});

export async function ensureCoinLedger(): Promise<void> {
  await ensurePlayerCoinsColumn();
  await ensureLedgerTable();
}

/** True for a primary-key / unique violation (a ledger key that was already used). */
export function isDuplicateKeyError(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error);
  return /UNIQUE constraint failed|PRIMARY KEY|SQLITE_CONSTRAINT/i.test(text);
}

/**
 * The two statements of one credit (or debit without a balance check): the
 * ledger row, then the balance change. With a `gate`, both statements apply
 * only when the gate holds — both see the same data inside the batch, so they
 * apply together or not at all.
 */
export function coinMoveStatements(move: CoinMove, gate?: Gate): Stmt[] {
  const cond = gate ? ` WHERE ${gate.sql}` : "";
  const andCond = gate ? ` AND (${gate.sql})` : "";
  const gateArgs = gate?.args ?? [];
  return [
    {
      sql: `INSERT INTO coin_ledger (key, player_name, player_id, delta, reason, created_at)
            SELECT ?, ?, (SELECT id FROM players WHERE name = ?), ?, ?, ?${cond}`,
      args: [move.key, move.playerName, move.playerName, move.delta, move.reason, Date.now(), ...gateArgs],
    },
    {
      sql: `UPDATE players SET coins = COALESCE(coins, 0) + ? WHERE name = ?${andCond}`,
      args: [move.delta, move.playerName, ...gateArgs],
    },
  ];
}

/**
 * Apply one credit exactly once. Returns false (and changes nothing) when the
 * key was already used.
 */
export async function creditOnce(move: CoinMove): Promise<boolean> {
  await ensureCoinLedger();
  try {
    await client.batch(coinMoveStatements(move), "write");
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/**
 * Atomic guarded spend with a ledger row. Returns the ledger key on success,
 * or null when the balance is too low (nothing changes).
 */
export async function spendCoins(
  playerName: string,
  amount: number,
  reason: string,
  keyPrefix: string
): Promise<string | null> {
  if (amount <= 0) return null;
  await ensureCoinLedger();
  const key = `${keyPrefix}:${randomUUID()}`;
  const results = await client.batch(
    [
      {
        sql: `INSERT INTO coin_ledger (key, player_name, player_id, delta, reason, created_at)
              SELECT ?, name, id, ?, ?, ? FROM players
              WHERE name = ? AND COALESCE(coins, 0) >= ?`,
        args: [key, -amount, reason, Date.now(), playerName, amount],
      },
      {
        sql: `UPDATE players SET coins = coins - ?
              WHERE name = ? AND EXISTS (SELECT 1 FROM coin_ledger WHERE key = ?)`,
        args: [amount, playerName, key],
      },
    ],
    "write"
  );
  return results[0].rowsAffected > 0 ? key : null;
}

/** Give back a spend made with `spendCoins` (idempotent per spend key). */
export async function refundSpend(spendKey: string, playerName: string, amount: number, reason: string) {
  if (amount <= 0) return;
  await creditOnce({ key: `${spendKey}:back`, playerName, delta: amount, reason });
}
