/**
 * The search box asks the server for matches (lib/db searchPlayers) instead of
 * downloading every player and filtering in the browser.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("player-search");
let db: typeof import("@/lib/db");

const names = async (q: string, limit?: number) => (await db.searchPlayers(q, limit)).map((p) => p.name);

before(async () => {
  db = await import("@/lib/db");
  await db.client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT, country TEXT,
    total_kills INTEGER, total_deaths INTEGER, total_assists INTEGER, kd_ratio REAL,
    total_mvps INTEGER, total_score INTEGER, total_headshot_percentage REAL, avg_hs_percent REAL,
    matches_played INTEGER, matches_won INTEGER, peak_elo INTEGER, total_play_time INTEGER,
    roblox_avatar_image TEXT, placement_done INTEGER DEFAULT 1, placement_games_played INTEGER,
    discord_id TEXT, discord_username TEXT, discord_avatar TEXT, mm_access INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0)`);
  await db.client.execute(`INSERT INTO players (name, elo, rank, discord_username, placement_done) VALUES
    ('Polski_ninja10', 1500, '[A3 | 1450-1649]', NULL, 1),
    ('PolskiXninja',   1900, '[S2 | 1900-2199]', NULL, 1),
    ('ninja',          1100, '[A1 | 1100-1249]', NULL, 1),
    ('superninja',     2000, '[S2 | 1900-2199]', NULL, 1),
    ('plord213',       1300, '[A2 | 1250-1449]', '@lordhandle', 1),
    ('calibrating',    1800, '[S1 | 1650-1899]', NULL, 0)`);
});

after(async () => {
  await tmp.cleanup(["players"]);
});

describe("searchPlayers", () => {
  it("matches part of a name, ignoring case", async () => {
    assert.deepEqual(await names("PLORD"), ["plord213"]);
  });

  it("treats _ as a real underscore, not a LIKE wildcard", async () => {
    assert.deepEqual(await names("polski_"), ["Polski_ninja10"]);
  });

  it("puts the exact name first, then names starting with it, then the rest by Elo", async () => {
    assert.deepEqual(await names("ninja"), ["ninja", "superninja", "PolskiXninja", "Polski_ninja10"]);
    assert.deepEqual(await names("polski"), ["PolskiXninja", "Polski_ninja10"]);
  });

  it("finds a player by Discord @handle, with or without the @", async () => {
    assert.deepEqual(await names("lordhandle"), ["plord213"]);
    assert.deepEqual(await names("@lordh"), ["plord213"]);
  });

  it("hides a calibrating player's rating like the leaderboard does", async () => {
    const [p] = await db.searchPlayers("calibrating");
    assert.equal(p.elo, 0);
    assert.equal(p.rank, "[?] Unranked");
  });

  it("caps the number of results and ignores an empty query", async () => {
    assert.equal((await names("n", 2)).length, 2);
    assert.deepEqual(await names("   "), []);
    assert.deepEqual(await names("%"), []);
  });
});
