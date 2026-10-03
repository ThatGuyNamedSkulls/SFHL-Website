/**
 * Season prestige (lib/prestige.ts): 20 wins a level, max 5, this season only;
 * each level pays its coins once and upgrades the player's one Prestige badge.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("prestige");
let prestige: typeof import("@/lib/prestige");
let cosmetics: typeof import("@/lib/cosmetics");
let client: typeof import("@/lib/db").client;

/** The player's prestige badge rows: [inventory id, slug, equipped, equipped_at]. */
async function prestigeBadges(name: string) {
  const rs = await client.execute({
    sql: `SELECT v.id, i.slug, v.equipped, v.equipped_at FROM cosmetic_inventory v
          JOIN cosmetic_items i ON i.id = v.item_id
          WHERE v.player_name = ? AND i.slug LIKE 'prestige-%' ORDER BY i.slug`,
    args: [name],
  });
  return rs.rows.map((r) => [Number(r.id), String(r.slug), Number(r.equipped), r.equipped_at == null ? null : Number(r.equipped_at)]);
}

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
  cosmetics = await import("@/lib/cosmetics");
  client = (await import("@/lib/db")).client;
  await client.execute(
    `CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, coins INTEGER DEFAULT 0, discord_id TEXT)`
  );
  await client.execute(`CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT, player_id INTEGER, match_id INTEGER,
    result TEXT, timestamp TEXT, is_test INTEGER DEFAULT 0, is_placement INTEGER DEFAULT 0)`);
  await client.execute("CREATE TABLE season_resets (season_name TEXT, reset_at TEXT)");
  await client.execute("INSERT INTO players (name, coins) VALUES ('ana', 0), ('bo', 0), ('cy', 0)");
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
  it("pays each reached level once (coins + one badge at the top level), even in parallel", async () => {
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
    assert.deepEqual(badges.rows.map((r) => String(r.slug)), ["prestige-2"], "one badge, upgraded");
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
    const badges = await prestigeBadges("ana");
    assert.deepEqual(badges.map((b) => b[1]), ["prestige-2"], "last season's Prestige 2 isn't downgraded");
  });

  it("upgrades the same inventory row, so an equipped badge stays equipped in its place", async () => {
    await addWins("cy", 20, "2026-09-15 12:00:00", 3000);
    await prestige.syncPrestige("cy");
    const [[id, slug]] = await prestigeBadges("cy");
    assert.equal(slug, "prestige-1");
    await client.execute({ sql: "UPDATE cosmetic_inventory SET equipped = 1, equipped_at = 1234 WHERE id = ?", args: [id] });
    await addWins("cy", 25, "2026-09-16 12:00:00", 4000);
    const s = await prestige.syncPrestige("cy");
    assert.deepEqual(s.newlyReached, [2]);
    assert.deepEqual(await prestigeBadges("cy"), [[id, "prestige-2", 1, 1234]]);
  });

  it("folds an old one-badge-per-level inventory down to its highest level", async () => {
    for (const lvl of [1, 2, 3]) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO cosmetic_items (slug, type, name, description, asset, rarity, created_at, price)
              VALUES (?, 'badge', ?, '', ?, 'rare', 0, 0)`,
        args: [`prestige-${lvl}`, `Prestige ${lvl}`, `/badges/prestige-${lvl}.svg`],
      });
    }
    const grant = (slug: string, equipped: number, at: number | null) =>
      client.execute({
        sql: `INSERT INTO cosmetic_inventory (player_name, item_id, granted_at, equipped, equipped_at)
              SELECT 'dee', id, 0, ?, ? FROM cosmetic_items WHERE slug = ?`,
        args: [equipped, at, slug],
      });
    await grant("prestige-1", 1, 50);
    await grant("prestige-2", 1, 80);
    await grant("prestige-3", 0, null);
    await cosmetics.mergePrestigeBadges();
    const rows = await prestigeBadges("dee");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].slice(1), ["prestige-3", 1, 50], "highest level, equipped at the earliest time");
    await cosmetics.mergePrestigeBadges();
    assert.equal((await prestigeBadges("dee")).length, 1, "running it again changes nothing");
  });

  it("no wins, no rewards", async () => {
    const s = await prestige.syncPrestige("bo");
    assert.equal(s.level, 0);
    assert.equal(await coins("bo"), 0);
  });
});
