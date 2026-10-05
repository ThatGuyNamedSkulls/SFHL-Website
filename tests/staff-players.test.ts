/**
 * The staff panel's player view (CBL bot docs/STAFF_PANEL_PLAN.md step 2):
 * account, active ban, warnings, timeouts, leaves, badges, items and season
 * rewards from the shared tables — and nothing breaks when the bot hasn't
 * created a table yet.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-players");
let sp: typeof import("@/lib/staff-players");
let client: typeof import("@/lib/db").client;

const TABLES = ["players", "badges", "cosmetic_items", "cosmetic_inventory", "player_bans", "timeouts", "warnings"];

before(async () => {
  sp = await import("@/lib/staff-players");
  client = (await import("@/lib/db")).client;
  await client.batch(
    [
      `CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT,
         placement_done INTEGER DEFAULT 0, placement_games_played INTEGER DEFAULT 0, matches_played INTEGER,
         matches_won INTEGER, discord_id INTEGER, discord_username TEXT, discord_avatar TEXT,
         roblox_avatar_image TEXT, coins INTEGER DEFAULT 0, season_rewards TEXT DEFAULT '')`,
      "CREATE TABLE badges (id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT, badge_name TEXT)",
      "CREATE TABLE cosmetic_items (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, type TEXT, name TEXT)",
      "CREATE TABLE cosmetic_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT, item_id INTEGER)",
      `CREATE TABLE player_bans (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, reason TEXT,
         banned_by TEXT, banned_at TEXT, lifted_at TEXT)`,
      `CREATE TABLE timeouts (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, reason TEXT,
         duration_minutes INTEGER, moderator_name TEXT, timestamp TEXT)`,
      "CREATE TABLE warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, warning_count INTEGER)",
      // A Discord id above 2^53 must come back exactly (stored as INTEGER by the bot).
      `INSERT INTO players (name, elo, rank, placement_done, matches_played, matches_won, discord_id, discord_username,
         coins, season_rewards)
       VALUES ('Alice', 1480, '[A2 | 1400-1549]', 1, 40, 22, 1513293927950716998, 'alice_cb', 750, 'S1 Top 10, Cup Winner, ')`,
      "INSERT INTO players (name, elo, rank) VALUES ('bob', 0, 'Unranked')",
      "INSERT INTO badges (player_name, badge_name) VALUES ('Alice', 'Beta Tester'), ('Alice', 'Cup Winner'), ('bob', 'Beta Tester')",
      "INSERT INTO cosmetic_items (slug, type, name) VALUES ('gold-card', 'card', 'Gold Card'), ('red-title', 'title', 'Red')",
      "INSERT INTO cosmetic_inventory (player_name, item_id) VALUES ('Alice', 1)",
      `INSERT INTO player_bans (discord_id, reason, banned_by, banned_at, lifted_at) VALUES
         ('1513293927950716998', 'old ban', 'mod', '2026-01-01 10:00:00', '2026-02-01 10:00:00'),
         ('1513293927950716998', 'cheating', 'mod2', '2026-09-01 10:00:00', NULL)`,
      `INSERT INTO timeouts (discord_id, reason, duration_minutes, moderator_name, timestamp) VALUES
         ('1513293927950716998', 'Trolling', 360, 'mod', '2026-09-02 12:00:00'),
         ('1513293927950716998', 'Queue AFK', 60, 'mod', '2026-09-03 12:00:00')`,
      "INSERT INTO warnings (discord_id, warning_count) VALUES ('1513293927950716998', 2)",
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

describe("staff player view", () => {
  it("shows the account, the active ban and the record", async () => {
    const view = await sp.staffPlayerView("alice"); // any case finds them
    assert.ok(view);
    assert.equal(view.player.name, "Alice");
    assert.equal(view.player.discordId, "1513293927950716998", "exact, not rounded");
    assert.equal(view.player.elo, 1480);
    assert.equal(view.player.coins, 750);
    assert.deepEqual(view.player.seasonRewards, ["S1 Top 10", "Cup Winner"]);
    assert.deepEqual(view.ban, { reason: "cheating", bannedBy: "mod2", bannedAt: "2026-09-01 10:00:00" }, "only the active ban");
    assert.equal(view.warnings, 2);
    assert.deepEqual(view.timeouts.map((t) => t.reason), ["Queue AFK", "Trolling"], "newest first");
    assert.deepEqual(view.leaves, [], "no leaving_incidents table yet: empty, not an error");
    assert.deepEqual(view.badges, ["Beta Tester", "Cup Winner"]);
    assert.deepEqual(view.inventory, [{ slug: "gold-card", name: "Gold Card", type: "card" }]);
  });

  it("shows placements as unranked with the raw Elo, and nothing Discord-based without an id", async () => {
    const view = await sp.staffPlayerView("bob");
    assert.ok(view);
    assert.equal(view.player.placementDone, false);
    assert.equal(view.player.tier, "UNRANKED");
    assert.equal(view.player.discordId, null);
    assert.equal(view.ban, null);
    assert.deepEqual(view.timeouts, []);
    assert.equal(await sp.staffPlayerView("nobody"), null);
  });

  it("lists items and badge names for the forms", async () => {
    const catalog = await sp.staffCatalog();
    assert.deepEqual(catalog.items.map((i) => i.slug), ["gold-card", "red-title"]);
    assert.deepEqual(catalog.badges, ["Beta Tester", "Cup Winner"], "each name once");
  });

  it("splits season rewards the way the bot stores them", () => {
    assert.deepEqual(sp.splitSeasonRewards("A, B, "), ["A", "B"]);
    assert.deepEqual(sp.splitSeasonRewards(null), []);
  });
});
