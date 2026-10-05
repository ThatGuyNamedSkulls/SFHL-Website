/**
 * The staff panel's Queue and Teams tabs (CBL bot docs/STAFF_PANEL_PLAN.md
 * step 6): each region's queue state from the bot's bot_state keys (open
 * modes, next server link, where its post is, the channel the website used
 * last), live matches with their server links, and every team with its titles.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-queue-teams");
let sq: typeof import("@/lib/staff-queue");
let st: typeof import("@/lib/staff-teams");
let client: typeof import("@/lib/db").client;

const NOW = Date.parse("2026-10-05T18:00:00Z");

before(async () => {
  sq = await import("@/lib/staff-queue");
  st = await import("@/lib/staff-teams");
  client = (await import("@/lib/db")).client;
  await client.batch(
    [
      "CREATE TABLE bot_state (key TEXT PRIMARY KEY, value TEXT)",
      `CREATE TABLE web_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT UNIQUE, discord_username TEXT,
         region TEXT, queue_mode TEXT, joined_at TEXT)`,
      "CREATE TABLE web_lobbies (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)",
      "CREATE TABLE web_teams (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)",
      `CREATE TABLE team_titles (id INTEGER PRIMARY KEY AUTOINCREMENT, team_id TEXT, title TEXT, awarded_by TEXT,
         awarded_by_id TEXT, awarded_at INTEGER)`,
      `INSERT INTO bot_state VALUES
         ('queue_open_regions', 'EU,NA'), ('queue_open_modes', 'EU:standard,NA:super'),
         ('queue_mode', '3'), ('queue_server_links', '{"EU":"https://roblox.com/eu"}'),
         ('queue_message:EU', '300000000000000777:123'), ('queue_message:SA', '300000000000000999:5'),
         ('staff_queue_channel', '300000000000000777')`,
      "INSERT INTO web_queue (discord_id, discord_username, region) VALUES ('1', 'a', 'EU'), ('2', 'b', 'eu'), ('3', 'c', 'NA')",
      {
        sql: "INSERT INTO web_lobbies VALUES (?, ?, ?), (?, ?, ?)",
        args: [
          "300000000000000888",
          JSON.stringify({ matchNumber: 4, selectedMap: "Mirage", region: "EU", queueMode: "league", server: { url: "https://roblox.com/m4" } }),
          NOW - 600_000,
          "300000000000000889",
          JSON.stringify({ matchNumber: 1 }),
          NOW - 5 * 3600_000,
        ],
      },
      `INSERT INTO web_teams VALUES
         ('t-alpha', '{"id":"t-alpha","name":"Alpha Squad","tag":"ALP","members":[{},{},{}]}', 2),
         ('t-beta', '{"id":"t-beta","name":"Beta","tag":""}', 1),
         ('t-bad', '{"id":"t-bad"}', 0)`,
      `INSERT INTO team_titles (team_id, title, awarded_by, awarded_at) VALUES
         ('t-alpha', 'Cup 1', 'mod', 1000), ('t-alpha', 'Cup 2', 'mod', 2000)`,
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["bot_state", "web_queue", "web_lobbies", "web_teams", "team_titles"]);
});

describe("staff queue view", () => {
  it("shows each region's queue from the bot's state", async () => {
    const view = await sq.staffQueueView(NOW);
    assert.equal(view.teamSize, 3);
    assert.equal(view.lastChannelId, "300000000000000777");
    const byId = Object.fromEntries(view.regions.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(byId), ["EU", "NA", "SA", "APAC", "OC"]);
    assert.deepEqual(
      [byId.EU.open, byId.EU.modes, byId.EU.waiting, byId.EU.nextServer, byId.EU.postChannelId],
      [true, ["standard"], 2, "https://roblox.com/eu", "300000000000000777"]
    );
    assert.deepEqual([byId.NA.modes, byId.NA.waiting, byId.NA.nextServer], [["super"], 1, null]);
    assert.equal(byId.SA.open, false);
    assert.equal(byId.SA.postChannelId, null, "a closed region's leftover post doesn't count");
  });

  it("lists live matches, league rooms too, with their server link", async () => {
    const view = await sq.staffQueueView(NOW);
    assert.deepEqual(view.liveMatches.map((m) => [m.id, m.matchNumber, m.serverUrl]), [
      ["300000000000000888", 4, "https://roblox.com/m4"],
    ]);
    assert.equal(sq.liveMatch("x", "not json", NOW), null);
  });
});

describe("staff teams view", () => {
  it("lists every team with its titles, newest title first", async () => {
    const { teams } = await st.staffTeamsView();
    assert.deepEqual(teams.map((t) => t.id), ["t-alpha", "t-beta"], "a team without a name is skipped, like the bot does");
    const [alpha, beta] = teams;
    assert.equal(alpha.members, 3);
    assert.deepEqual(alpha.titles.map((t) => t.title), ["Cup 2", "Cup 1"]);
    assert.deepEqual(beta.titles, []);
  });
});
