/**
 * The staff panel's Season tab data (CBL bot docs/STAFF_PANEL_PLAN.md step 7):
 * the Top 10 in /season reset's own order, this season's ranked matches since
 * the last reset, and past seasons from both season_resets and season_stats
 * (seasons ended before season_resets existed).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-season");
let ss: typeof import("@/lib/staff-season");
let client: typeof import("@/lib/db").client;

before(async () => {
  ss = await import("@/lib/staff-season");
  client = (await import("@/lib/db")).client;
  await client.batch(
    [
      `CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER, rank TEXT,
         matches_played INTEGER, matches_won INTEGER, placement_done INTEGER)`,
      "CREATE TABLE season_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, season_name TEXT, reset_at TEXT)",
      "CREATE TABLE season_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, season_name TEXT, player_name TEXT)",
      "CREATE TABLE match_history (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER, player_name TEXT, timestamp TEXT)",
      `INSERT INTO players (name, elo, rank, matches_played, matches_won, placement_done) VALUES
         ('tied_more_wins', 1500, 'A', 20, 12, 1), ('tied_fewer_wins', 1500, 'A', 20, 9, 1),
         ('top', 1900, 'S', 30, 20, 1), ('placing', 0, 'Unranked', 3, 1, 0)`,
      `INSERT INTO season_resets (season_name, reset_at) VALUES ('Season 1', '2026-06-01 12:00:00')`,
      `INSERT INTO season_stats (season_name, player_name) VALUES
         ('Season 0', 'a'), ('Season 1', 'a'), ('Season 1', 'b')`,
      `INSERT INTO match_history (match_id, player_name, timestamp) VALUES
         (1, 'a', '2026-05-01 10:00:00'), (2, 'a', '2026-07-01 10:00:00'), (2, 'b', '2026-07-01 10:00:00'),
         (3, 'a', '2026-08-01 10:00:00'), (NULL, 'x', '2026-08-02 10:00:00')`,
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["players", "season_resets", "season_stats", "match_history"]);
});

describe("staff season view", () => {
  it("lists the Top 10 the way /season reset picks it", async () => {
    const view = await ss.staffSeasonView();
    assert.deepEqual(view.top10.map((p) => p.name), ["top", "tied_more_wins", "tied_fewer_wins", "placing"]);
    assert.equal(view.placedPlayers, 3);
  });

  it("counts this season's ranked matches since the last reset", async () => {
    const view = await ss.staffSeasonView();
    assert.equal(view.since, Date.parse("2026-06-01T12:00:00Z"));
    assert.equal(view.rankedMatches, 2, "matches 2 and 3; not match 1 from last season, not unranked rows");
  });

  it("lists past seasons, also ones only in the stats archive", async () => {
    const view = await ss.staffSeasonView();
    assert.deepEqual(
      view.pastSeasons.map((s) => [s.name, s.players, s.endedAt]),
      [
        ["Season 1", 2, Date.parse("2026-06-01T12:00:00Z")],
        ["Season 0", 1, null],
      ]
    );
  });
});
