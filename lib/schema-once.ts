/**
 * Table setup that runs once per code version, not once per server instance
 * (docs/PERFORMANCE_PLAN.md step 5).
 *
 * Every Vercel instance used to re-send its CREATE/ALTER statements on its
 * first request (~30 round trips to Turso). Now each setup function has a
 * fingerprint (a hash of its own code, so it changes whenever its SQL does).
 * After it runs, the fingerprint is stored in bot_state as `web_schema:<name>`;
 * instances that find a matching fingerprint skip the setup (one small read of
 * all fingerprints per instance). Tests (HL_TESTING) always run the setup and
 * never store anything.
 */
import { client } from "@/lib/db";

function fingerprint(text: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

let stored: Promise<Map<string, string>> | null = null;

function storedFingerprints(): Promise<Map<string, string>> {
  if (!stored) {
    stored = client
      .execute("SELECT key, value FROM bot_state WHERE key LIKE 'web_schema:%'")
      .then((rs) => new Map(rs.rows.map((r) => [String(r.key), String(r.value)])))
      .catch(() => new Map<string, string>()); // no bot_state yet: run everything
  }
  return stored;
}

/** A memoized setup function: skips `run` when this code version already ran against this database. */
export function schemaOnce(name: string, run: () => Promise<void>): () => Promise<void> {
  const key = `web_schema:${name}`;
  const version = fingerprint(run.toString());
  let ready: Promise<void> | null = null;
  return () => {
    if (!ready) {
      ready = (async () => {
        if (process.env.HL_TESTING) {
          await run();
          return;
        }
        if ((await storedFingerprints()).get(key) === version) return;
        await run();
        await client
          .execute({
            sql: "INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)",
            args: [key, version],
          })
          .catch(() => undefined); // not stored: the next instance simply runs it again
      })().catch((e) => {
        ready = null;
        throw e;
      });
    }
    return ready;
  };
}

/**
 * Run DDL statements in one round trip; if the batch fails (e.g. one index's
 * table doesn't exist yet), fall back to one by one, ignoring failures — the
 * same result as the old statement-by-statement loops.
 */
export async function ddlBatch(statements: string[]): Promise<void> {
  if (!statements.length) return;
  try {
    await client.batch(statements, "write");
  } catch {
    for (const sql of statements) await client.execute(sql).catch(() => undefined);
  }
}

/** Which of `columns` a table is missing (PRAGMA table_info), for "add column if missing". */
export async function missingColumns(tables: Record<string, string[]>): Promise<Record<string, string[]>> {
  const names = Object.keys(tables);
  const info = await client.batch(names.map((t) => `PRAGMA table_info(${t})`), "read");
  const out: Record<string, string[]> = {};
  names.forEach((t, i) => {
    const have = new Set(info[i].rows.map((r) => String((r as Record<string, unknown>).name)));
    out[t] = tables[t].filter((c) => !have.has(c));
  });
  return out;
}
