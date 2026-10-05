/**
 * Reporting a player from the website (lib/reports.ts): the same `reports`
 * row /mod report makes, marked as from the website; no reporting yourself,
 * an unknown player or the same player twice in a few minutes; staff can mark
 * a report handled and open it again.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("reports");
let reports: typeof import("@/lib/reports");
let client: typeof import("@/lib/db").client;

const ME = { discordId: "1513293927950716998", name: "alice_discord" };

before(async () => {
  reports = await import("@/lib/reports");
  client = (await import("@/lib/db")).client;
  await client.batch(
    [
      "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, discord_id INTEGER)",
      `INSERT INTO players (id, name, discord_id) VALUES (1, 'Alice', ${ME.discordId}), (2, 'Bob', 222222222222222222)`,
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["reports", "players"]);
});

async function rejects(promise: Promise<unknown>, message: RegExp) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof reports.ReportError, String(e));
    assert.match((e as Error).message, message);
    return true;
  });
}

describe("player reports", () => {
  it("files a report like /mod report, marked as from the website", async () => {
    const done = await reports.createReport(ME, "Bob", "Trolling: kept blocking the door in round 4");
    assert.equal(done.reported, "Bob");
    const rs = await client.execute(
      "SELECT reporter_name, reporter_player_id, reported_player, reported_player_id, reason, source, handled_at FROM reports"
    );
    const row = rs.rows[0];
    const named = Object.fromEntries(rs.columns.map((c) => [c, row[c]]));
    assert.deepEqual(named, {
      reporter_name: "Alice",
      reporter_player_id: 1,
      reported_player: "Bob",
      reported_player_id: 2,
      reason: "Trolling: kept blocking the door in round 4",
      source: "website",
      handled_at: null,
    });
  });

  it("refuses yourself, unknown players, empty reasons and quick repeats", async () => {
    await rejects(reports.createReport(ME, "Alice", "self report test"), /yourself/);
    await rejects(reports.createReport(ME, "Nobody", "who is this"), /doesn't exist/);
    await rejects(reports.createReport(ME, "Bob", "hm"), /a few words/);
    await rejects(reports.createReport(ME, "Bob", "x".repeat(501)), /under 500/);
    await rejects(reports.createReport(ME, "Bob", "Toxic in chat again"), /already reported Bob/);
  });

  it("lets staff mark a report handled and open it again", async () => {
    const id = Number((await client.execute("SELECT id FROM reports LIMIT 1")).rows[0].id);
    assert.equal(await reports.setReportHandled(id, true, "staffer"), true);
    let row = (await client.execute({ sql: "SELECT handled_at, handled_by FROM reports WHERE id = ?", args: [id] })).rows[0];
    assert.ok(Number(row.handled_at) > 0);
    assert.equal(row.handled_by, "staffer");
    await reports.setReportHandled(id, false, "staffer");
    row = (await client.execute({ sql: "SELECT handled_at, handled_by FROM reports WHERE id = ?", args: [id] })).rows[0];
    assert.equal(row.handled_at, null);
    assert.equal(await reports.setReportHandled(999, true, "staffer"), false);
  });
});
