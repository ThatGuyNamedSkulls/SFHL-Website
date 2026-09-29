/**
 * Counter Blox's own stats (first kills, 2K-5K rounds, rounds played) that the
 * bot's /rankgame saves on match_history: the match page reads them back
 * per row, and the profile sums them for the season.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("cb-stats");
let db: typeof import("@/lib/db");
let stats: typeof import("@/lib/match-stats");

const INSERT = `INSERT INTO match_history (player_name, match_id, timestamp, result, kills, deaths, assists,
  hs_percentage, elo_change, points, mvps, round_score, is_placement, is_test, damage, first_kills,
  rounds_2k, rounds_3k, rounds_4k, rounds_5k, rounds_played)
  VALUES (?, ?, ?, 'W', 20, 15, 3, 50, 20, 40, 2, '13,9', ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

before(async () => {
  db = await import("@/lib/db");
  stats = await import("@/lib/match-stats");
  await db.client.execute("CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE)");
  await db.client.execute(`CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, player_name TEXT, map_name TEXT, region TEXT,
    kills INTEGER, deaths INTEGER, assists INTEGER, hs_percentage REAL, elo_change INTEGER, result TEXT,
    points INTEGER, executed_by TEXT, timestamp TEXT, mvps INTEGER, match_id INTEGER, round_score TEXT,
    is_placement INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0, team INTEGER, mode TEXT, is_sub INTEGER,
    left_early INTEGER, sub_share REAL, player_rank TEXT, elo_before INTEGER, win_chance REAL,
    skill_before INTEGER, damage INTEGER, first_kills INTEGER, rounds_2k INTEGER, rounds_3k INTEGER,
    rounds_4k INTEGER, rounds_5k INTEGER, rounds_played INTEGER)`);
  await db.client.execute("INSERT INTO players (name) VALUES ('yvvt')");
  const row = (match: number, ts: string, extra: (number | null)[], placement = 0, test = 0) =>
    db.client.execute({ sql: INSERT, args: ["yvvt", match, ts, placement, test, ...extra] });
  //                                          dmg   FK  2K 3K 4K 5K  RP
  await row(1, "2026-09-01 10:00:00", [2941, 3, 5, 3, 0, 0, 29]); // last season
  await row(2, "2026-09-29 19:53:29", [2941, 3, 5, 3, 0, 0, 29]);
  await row(3, "2026-09-29 21:00:00", [1500, 1, 2, 0, 1, 1, 22]);
  await row(4, "2026-09-29 22:00:00", [1800, null, null, null, null, null, null]); // ranked by hand
  await row(5, "2026-09-29 23:00:00", [900, 1, 1, 0, 0, 0, 13], 1); // placement
  await row(6, "2026-09-29 23:30:00", [900, 1, 1, 0, 0, 0, 13], 0, 1); // /testrankdummies test
});

after(async () => {
  await tmp.cleanup(["match_history", "players"]);
});

describe("damagePerRound", () => {
  it("is damage over rounds, rounded", () => {
    assert.equal(stats.damagePerRound(2941, 29), 101);
    assert.equal(stats.damagePerRound(null, 29), null);
    assert.equal(stats.damagePerRound(2941, 0), null);
    assert.equal(stats.damagePerRound(2941, null), null);
  });
});

describe("getCbStats", () => {
  it("sums this season's /rankgame games only", async () => {
    assert.deepEqual(await db.getCbStats("yvvt", "2026-09-10 00:00:00"), {
      matches: 2,
      roundsPlayed: 51,
      damage: 4441,
      firstKills: 4,
      rounds2k: 7,
      rounds3k: 3,
      rounds4k: 1,
      rounds5k: 1,
    });
  });

  it("covers every season without a reset, and is null with no games", async () => {
    assert.equal((await db.getCbStats("yvvt", null))?.matches, 3);
    assert.equal(await db.getCbStats("nobody", null), null);
  });
});

describe("getMatchesByMatchId", () => {
  it("returns the Counter Blox columns with the match rows", async () => {
    const [row] = await db.getMatchesByMatchId(3);
    assert.equal(row.damage, 1500);
    assert.deepEqual(
      [row.first_kills, row.rounds_2k, row.rounds_3k, row.rounds_4k, row.rounds_5k, row.rounds_played],
      [1, 2, 0, 1, 1, 22]
    );
    const [manual] = await db.getMatchesByMatchId(4);
    assert.equal(manual.damage, 1800);
    assert.equal(manual.rounds_played, null);
  });
});
