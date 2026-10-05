/**
 * The staff panel's Moderation tab (CBL bot docs/STAFF_PANEL_PLAN.md step 4):
 * reports newest first (and which reported names are players), timeouts and
 * whether they still run (start + length, not the bot's local expiry), early
 * leaves, current suspensions only, everyone's player name by Discord id —
 * and an empty tab before the bot has made its tables.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-moderation");
let sm: typeof import("@/lib/staff-moderation");
let client: typeof import("@/lib/db").client;
let emptyBefore: Awaited<ReturnType<typeof import("@/lib/staff-moderation")["staffModerationView"]>>;

const NOW = Date.parse("2026-10-05T18:00:00Z");
const ALICE = "1513293927950716998"; // above 2^53: must match exactly

before(async () => {
  sm = await import("@/lib/staff-moderation");
  client = (await import("@/lib/db")).client;
  emptyBefore = await sm.staffModerationView(NOW);
  await client.batch(
    [
      "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, discord_id INTEGER)",
      // The view already made the reports table (with its handled / source columns).
      `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_name TEXT, reported_player TEXT,
         reason TEXT, timestamp TEXT)`,
      `CREATE TABLE timeouts (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, user_name TEXT, reason TEXT,
         duration_minutes INTEGER, moderator_name TEXT, expiry_time TEXT, timestamp TEXT)`,
      `CREATE TABLE leaving_incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, user_name TEXT,
         elo_penalty INTEGER, incident_count INTEGER, timestamp TEXT)`,
      `CREATE TABLE suspensions (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, user_name TEXT, reason TEXT,
         started_at TEXT, expires_at TEXT, kept_role INTEGER DEFAULT 0, lifted INTEGER DEFAULT 0)`,
      `INSERT INTO players (name, discord_id) VALUES ('Alice', ${ALICE}), ('bob', 222222222222222222)`,
      `INSERT INTO reports (reporter_name, reported_player, reason, timestamp) VALUES
         ('carol', 'bob', 'old report', '2026-09-01 10:00:00'),
         ('dave', 'ghost', 'not a player', '2026-10-04 10:00:00'),
         ('erin', 'Alice', 'griefing', '2026-10-05 17:00:00')`,
      "UPDATE reports SET handled_at = 1, handled_by = 'mod', source = 'website' WHERE reported_player = 'ghost'",
      // A Trolling timeout (6 h) from 2 h ago still runs; the bogus expiry_time is ignored.
      `INSERT INTO timeouts (discord_id, user_name, reason, duration_minutes, moderator_name, expiry_time, timestamp) VALUES
         ('${ALICE}', 'alice_cb', 'Trolling', 360, 'mod', '1970-01-01', '2026-10-05 16:00:00'),
         ('222222222222222222', 'bob', 'Queue AFK', 60, 'mod', '2099-01-01', '2026-10-05 10:00:00'),
         ('333', 'stranger', 'Ghosting', 10080, 'mod', '', '2026-10-01 10:00:00')`,
      `INSERT INTO leaving_incidents (discord_id, user_name, elo_penalty, incident_count, timestamp) VALUES
         ('222222222222222222', 'bob', 12, 2, '2026-10-05 12:00:00')`,
      `INSERT INTO suspensions (discord_id, user_name, reason, started_at, expires_at, lifted) VALUES
         ('222222222222222222', 'bob', 'Leaving mid game', '2026-10-05 12:00:00', '2026-10-05 20:00:00', 0),
         ('${ALICE}', 'alice_cb', 'Leaving mid game', '2026-10-01 12:00:00', '2026-10-01 13:00:00', 0),
         ('333', 'stranger', 'Leaving mid game', '2026-10-05 12:00:00', '2026-10-06 12:00:00', 1)`,
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["players", "reports", "timeouts", "leaving_incidents", "suspensions"]);
});

describe("staff moderation view", () => {
  it("is empty, not an error, before the bot made its tables", () => {
    assert.deepEqual(emptyBefore.reports, []);
    assert.deepEqual(emptyBefore.counts, { suspendedNow: 0, timedOutNow: 0, reportsThisWeek: 0, openReports: 0 });
  });

  it("lists reports newest first and says which reported names are players", async () => {
    const view = await sm.staffModerationView(NOW);
    assert.deepEqual(view.reports.map((r) => r.reported), ["Alice", "ghost", "bob"]);
    assert.deepEqual(view.reports.map((r) => r.reportedIsPlayer), [true, false, true]);
    assert.equal(view.counts.reportsThisWeek, 2);
    assert.equal(view.counts.openReports, 2, "the handled one isn't open");
    const ghost = view.reports.find((r) => r.reported === "ghost");
    assert.deepEqual([ghost?.handledBy, ghost?.source], ["mod", "website"]);
    assert.equal(view.reports.find((r) => r.reported === "bob")?.source, "discord", "older rows count as Discord");
  });

  it("works out running timeouts from start + length, with today's player names", async () => {
    const view = await sm.staffModerationView(NOW);
    const byName = Object.fromEntries(view.timeouts.map((t) => [t.name, t]));
    assert.equal(byName.alice_cb.player, "Alice", "matched by the exact Discord id");
    assert.equal(byName.alice_cb.active, true);
    assert.equal(byName.alice_cb.endsAt, Date.parse("2026-10-05T22:00:00Z"));
    assert.equal(byName.bob.active, false, "an hour from 10:00 ended at 11:00, whatever expiry_time says");
    assert.equal(byName.stranger.active, true);
    assert.equal(byName.stranger.player, null, "no account: no player to open");
    assert.equal(view.counts.timedOutNow, 2);
  });

  it("shows only suspensions still running, and the early leaves", async () => {
    const view = await sm.staffModerationView(NOW);
    assert.deepEqual(view.suspended.map((s) => s.player), ["bob"]);
    assert.equal(view.suspended[0].endsAt, Date.parse("2026-10-05T20:00:00Z"));
    assert.equal(view.counts.suspendedNow, 1);
    assert.deepEqual(
      view.leaves.map((l) => [l.player, l.count, l.eloPenalty]),
      [["bob", 2, 12]]
    );
  });

  it("reads SQLite UTC text", () => {
    assert.equal(sm.utcMs("2026-10-05 18:00:00"), NOW);
    assert.equal(sm.utcMs(""), 0);
    assert.equal(sm.utcMs("garbage"), 0);
  });
});
