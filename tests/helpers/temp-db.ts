/**
 * Throwaway local database for a test file.
 *
 * Call `createTempDb()` BEFORE importing anything from `@/lib/*` (lib/db reads
 * the URL at import time), then `await cleanup([...tables])` in `after()`.
 *
 * Cleanup deletes every row the tests left in those tables and verifies they
 * are empty. The database FILE lives under the run's root folder, which
 * tests/global-setup.ts removes once every test process has exited (Windows
 * keeps the file locked until then). The live Turso database is never
 * touched: lib/db refuses a non-file URL while HL_TESTING is set.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempDb(label: string) {
  const root = process.env.HL_TEST_ROOT || tmpdir();
  const dir = mkdtempSync(join(root, `${label}-`));
  process.env.HL_TESTING = "1";
  process.env.TURSO_DATABASE_URL = "file:" + join(dir, "test.db").replace(/\\/g, "/");
  delete process.env.TURSO_AUTH_TOKEN;

  async function cleanup(tables: string[]): Promise<void> {
    const { client } = await import("@/lib/db");
    try {
      for (const table of tables) {
        try {
          await client.execute(`DELETE FROM ${table}`);
          const rs = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
          if (Number(rs.rows[0].n) !== 0) throw new Error(`${table} still has test rows`);
        } catch (e) {
          if (!String(e).includes("no such table")) throw e;
        }
      }
    } finally {
      client.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* still locked by this process — the global teardown removes it */
      }
    }
  }

  return { dir, cleanup };
}
