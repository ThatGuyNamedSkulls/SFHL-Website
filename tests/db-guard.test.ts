/**
 * Safety net: while HL_TESTING is set, lib/db must refuse any database that
 * isn't a local file — so no test can ever write to the live Turso database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function importDb(url: string) {
  return spawnSync(process.execPath, ["--import", "tsx", join("tests", "helpers", "import-db.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, HL_TESTING: "1", TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" },
    encoding: "utf8",
  });
}

describe("database guard", () => {
  it("refuses a remote database during tests", () => {
    const run = importDb("libsql://example-live.turso.io");
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /Refusing to open a non-local database/);
  });

  it("allows a local file database", () => {
    const run = importDb("file::memory:");
    assert.equal(run.status, 0, run.stderr);
  });
});
