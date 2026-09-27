/**
 * Season prestige (lib/prestige.ts): 20 wins a level, max 5, this season only;
 * each level pays its coins and badge once.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("prestige");
let prestige: typeof import("@/lib/prestige");
let client: typeof import("@/lib/db").client;

async function coins(name: string) {
  const rs = await client.execute({ sql: "SELECT coins FROM players WHERE name = ?", args: [name] });
  return Number(rs.rows[0]?.coins ?? 0);
}

async function addWins(
  name: string,
  count: number,
  timestamp: string,
  offset = 0,
  flags: { placement?: boolean; test?: boolean } = {}
) {
  for (let i = 0; i < count; i++) {
    await client.execute({
      sql: `INSERT INTO match_history (player_name, match_id, result, timestamp, is_test, is_placement)
            VALUES (?, ?, 'W', ?, ?, ?)`,
      args: [name, 10_000 + offset + i, timestamp, flags.test ? 1 : 0, flags.placement ? 1 : 0],
    });
  }
}

before(async () => {
  prestige = await import("@/lib/prestige");
  client = (await import("@/lib/db")).client;
  await client.execute(
    `CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, coins INTEGER DEFAULT 0, discord_id TEXT)`
  );
  await client.execute(`CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT, player_id INTEGER, match_id INTEGER,
    result TEXT, timestamp TEXT, is_test INTEGER DEFAULT 0, is_placement INTEGER DEFAULT 0)`);
  await client.execute("CREATE TABLE season_resets (season_name TEXT, reset_at TEXT)");
  await client.execute("INSERT INTO players (name, coins) VALUES ('ana', 0), ('bo', 0)");
});

after(async () => {
  await tmp.cleanup([
    "cosmetic_inventory", "cosmetic_items", "coin_ledger", "notifications", "match_history",
    "season_resets", "players",
  ]);
});

describe("prestige levels", () => {
  it("20 wins a level, capped at 5", () => {
    assert.equal(prestige.prestigeFromWins(0).level, 0);
    assert.equal(prestige.prestigeFromWins(19).level, 0);
    const p1 = prestige.prestigeFromWins(20);
    assert.equal(p1.level, 1);
    assert.equal(p1.nextAt, 40);
    assert.equal(p1.winsIntoLevel, 0);
    assert.equal(prestige.prestigeFromWins(47).winsIntoLevel, 7);
    const max = prestige.prestigeFromWins(250);
    assert.equal(max.level, 5);
    assert.equal(max.maxed, true);
    assert.equal(max.nextAt, null);
  });
});

describe("prestige sync", () => {
  it("pays each reached level once (coins + badge), even in parallel", async () => {
    await addWins("ana", 45, "2026-09-01 10:00:00");
    // Placement and dummy wins never count.
    await addWins("ana", 30, "2026-09-01 10:00:00", 500, { placement: true });
    await addWins("ana", 30, "2026-09-01 10:00:00", 800, { test: true });
    const results = await Promise.all(Array.from({ length: 4 }, () => prestige.syncPrestige("ana")));
    assert.equal(results[0].level, 2);
    assert.equal(results.flatMap((r) => r.newlyReached).length, 2, "levels 1 and 2 paid once in total");
    assert.equal(await coins("ana"), 2 * prestige.PRESTIGE_COINS_PER_LEVEL);
    const badges = await client.execute(
      `SELECT i.slug FROM cosmetic_inventory v JOIN cosmetic_items i ON i.id = v.item_id
       WHERE v.player_name = 'ana' ORDER BY i.slug`
    );
    assert.deepEqual(badges.rows.map((r) => String(r.slug)), ["prestige-1", "prestige-2"]);
    const again = await prestige.syncPrestige("ana");
    assert.deepEqual(again.newlyReached, []);
    assert.equal(await coins("ana"), 2 * prestige.PRESTIGE_COINS_PER_LEVEL);
  });

  it("a new season starts from zero and pays again", async () => {
    await client.execute("INSERT INTO season_resets VALUES ('Season 1', '2026-09-10 00:00:00')");
    const fresh = await prestige.syncPrestige("ana");
    assert.equal(fresh.season.number, 2);
    assert.equal(fresh.level, 0, "last season's wins don't count");
    await addWins("ana", 20, "2026-09-12 12:00:00", 2000);
    const s2 = await prestige.syncPrestige("ana");
    assert.equal(s2.level, 1);
    assert.deepEqual(s2.newlyReached, [1]);
    assert.equal(await coins("ana"), 3 * prestige.PRESTIGE_COINS_PER_LEVEL);
  });

  it("no wins, no rewards", async () => {
    const s = await prestige.syncPrestige("bo");
    assert.equal(s.level, 0);
    assert.equal(await coins("bo"), 0);
  });
});
