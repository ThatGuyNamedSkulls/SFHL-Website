/**
 * Safe read-modify-write for the JSON-blob tables (clans, teams, tournaments,
 * lobbies) — docs/WEBSITE_SECURITY_REPORT.md M3 / H2.
 *
 * Each attempt reads the row, runs `mutate` on the fresh value (so permission
 * and rule checks always see current data), and writes back with
 * `WHERE data = <exactly what was read>`. If anyone else wrote in between —
 * another request or the Discord bot — nothing is written and we retry.
 *
 * Every write stamps a fresh `rev` nonce into the blob. Coin moves returned by
 * `mutate` go in the same batch, gated on the row now holding exactly the new
 * blob, so a request that lost the race credits nothing; the ledger key stops
 * any repeat on top of that.
 */
import { randomUUID } from "crypto";
import type { InValue } from "@libsql/client";
import { client } from "@/lib/db";
import {
  coinMoveStatements,
  ensureCoinLedger,
  isDuplicateKeyError,
  type CoinMove,
  type Stmt,
} from "@/lib/coin-ledger";

export type BlobTable = "web_tournaments" | "web_clubs" | "web_teams" | "web_lobbies";

export interface MutateResult {
  coins?: CoinMove[];
}

/** Too many concurrent writers: the caller should just try again. */
export class BusyError extends Error {}
/** A coin move in this change was already applied by an earlier request. */
export class AlreadyDoneError extends Error {}

const ATTEMPTS = 6;

export async function mutateBlob<T extends object>(opts: {
  table: BlobTable;
  id: string;
  parse: (raw: string) => T | null;
  notFound: string;
  mutate: (value: T) => Promise<MutateResult | void> | MutateResult | void;
  /** Extra columns written with the blob (e.g. updated_at, club_id). */
  columns?: (value: T) => Record<string, InValue>;
}): Promise<T> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const rs = await client.execute({
      sql: `SELECT data FROM ${opts.table} WHERE id = ?`,
      args: [opts.id],
    });
    if (!rs.rows.length) throw new Error(opts.notFound);
    const raw = String(rs.rows[0].data);
    const value = opts.parse(raw);
    if (!value) throw new Error(opts.notFound);

    const result = (await opts.mutate(value)) || {};
    (value as { rev?: string }).rev = randomUUID();
    const next = JSON.stringify(value);
    const cols = opts.columns ? opts.columns(value) : {};
    const keys = Object.keys(cols);
    const set = ["data = ?", ...keys.map((k) => `${k} = ?`)].join(", ");
    const stmts: Stmt[] = [
      {
        sql: `UPDATE ${opts.table} SET ${set} WHERE id = ? AND data = ?`,
        args: [next, ...keys.map((k) => cols[k]), opts.id, raw],
      },
    ];
    const moves = result.coins ?? [];
    if (moves.length) {
      await ensureCoinLedger();
      const gate = {
        sql: `EXISTS (SELECT 1 FROM ${opts.table} WHERE id = ? AND data = ?)`,
        args: [opts.id, next] as InValue[],
      };
      for (const move of moves) stmts.push(...coinMoveStatements(move, gate));
    }

    let results;
    try {
      results = await client.batch(stmts, "write");
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new AlreadyDoneError("That was already processed.");
      throw error;
    }
    if (results[0].rowsAffected > 0) return value;
    // Lost the race — re-read and re-check against the newer data.
  }
  throw new BusyError("Too many changes at once — please try again.");
}

/**
 * Delete a row only if `check` passes on its current data and nobody changed
 * it in between (e.g. a captain can't delete a team they just handed over).
 */
export async function deleteBlobIf<T extends object>(opts: {
  table: BlobTable;
  id: string;
  parse: (raw: string) => T | null;
  notFound: string;
  check: (value: T) => void | Promise<void>;
}): Promise<T> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const rs = await client.execute({
      sql: `SELECT data FROM ${opts.table} WHERE id = ?`,
      args: [opts.id],
    });
    if (!rs.rows.length) throw new Error(opts.notFound);
    const raw = String(rs.rows[0].data);
    const value = opts.parse(raw);
    if (!value) throw new Error(opts.notFound);
    await opts.check(value);
    const del = await client.execute({
      sql: `DELETE FROM ${opts.table} WHERE id = ? AND data = ?`,
      args: [opts.id, raw],
    });
    if (del.rowsAffected > 0) return value;
  }
  throw new BusyError("Too many changes at once — please try again.");
}
