/**
 * The badge next to a name: Mod Pin (Match Staff) beats Top 10, which beats
 * the first badge the player equipped, which takes Verified's place. Top 10 is
 * the bot's rule: highest Elo (> 0), then most wins.
 * Also: the file name a map's image is looked up under (public/maps/).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("name-badge");
let badges: typeof import("@/lib/name-badge");
let index: Awaited<ReturnType<typeof import("@/lib/name-badge").badgeIndex>>;

before(async () => {
  const { client } = await import("@/lib/db");
  badges = await import("@/lib/name-badge");
  await client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, matches_won INTEGER DEFAULT 0,
    discord_id TEXT, match_staff INTEGER DEFAULT 0)`);
  // 11 ranked players: p1 (2000) … p11 (1000); p10 and p11 tie on Elo, p10 has more wins.
  for (let i = 1; i <= 11; i++) {
    const elo = i === 11 ? 1100 : 2100 - i * 100;
    await client.execute({
      sql: "INSERT INTO players (name, elo, matches_won, discord_id) VALUES (?, ?, ?, ?)",
      args: [`p${i}`, elo, i === 10 ? 50 : 10, String(100 + i)],
    });
  }
  await client.execute("INSERT INTO players (name, elo, discord_id, match_staff) VALUES ('Mod', 900, '900', 1)");
  await client.execute("INSERT INTO players (name, elo, discord_id, match_staff) VALUES ('p1staff', 0, NULL, 0)");
  await client.execute("UPDATE players SET match_staff = 1 WHERE name = 'p1'");
  for (const [name, did] of [["Collector", "501"], ["Renamed", "777"], ["NoArt", null], ["Owner", "502"]]) {
    await client.execute({ sql: "INSERT INTO players (name, elo, discord_id) VALUES (?, 0, ?)", args: [name, did] });
  }
  await client.execute(`CREATE TABLE cosmetic_items (
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE, type TEXT, name TEXT, asset TEXT)`);
  await client.execute(`CREATE TABLE cosmetic_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT, player_id INTEGER, item_id INTEGER,
    equipped INTEGER DEFAULT 0, equipped_at INTEGER)`);
  await client.execute(`INSERT INTO cosmetic_items (id, slug, type, name, asset) VALUES
    (1, 'gold-cup', 'badge', 'Gold Cup', '/badges/gold-cup.png'),
    (2, 'founder', 'badge', 'Founder', '/badges/founder.png'),
    (3, 'red-card', 'card', 'Red Card', '/cards/red.png'),
    (4, 'no-art', 'badge', 'No Art', NULL)`);
  const id = async (name: string) =>
    Number((await client.execute({ sql: "SELECT id FROM players WHERE name = ?", args: [name] })).rows[0].id);
  const own = (name: string, playerId: number | null, item: number, equipped: number, at: number | null) =>
    client.execute({
      sql: `INSERT INTO cosmetic_inventory (player_name, player_id, item_id, equipped, equipped_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [name, playerId, item, equipped, at],
    });
  // Collector equipped Founder after Gold Cup, and a card before both.
  await own("Collector", await id("Collector"), 2, 1, 200);
  await own("Collector", await id("Collector"), 1, 1, 100);
  await own("Collector", await id("Collector"), 3, 1, 50);
  // Top 10 and Match Staff keep their own badge over an equipped one.
  await own("p2", await id("p2"), 1, 1, 10);
  await own("Mod", await id("Mod"), 2, 1, 10);
  // Linked by player id only: the row still has the old name.
  await own("OldName", await id("Renamed"), 2, 1, 10);
  // Owned but not equipped: nothing.
  await own("Owner", await id("Owner"), 1, 0, null);
  // A badge with no image (the client falls back to Verified).
  await own("NoArt", await id("NoArt"), 4, 1, 10);
  index = await badges.badgeIndex();
});

after(async () => {
  await tmp.cleanup(["cosmetic_inventory", "cosmetic_items", "players"]);
});

describe("name badge ladder", () => {
  it("Match Staff gets the Mod Pin, even when also Top 10", () => {
    assert.equal(badges.nameBadgeFor(index, { discordId: "900" }), "staff");
    assert.equal(badges.nameBadgeFor(index, { playerName: "p1" }), "staff");
  });

  it("the top 10 by Elo, then wins, get the Top 10 badge", () => {
    assert.equal(badges.nameBadgeFor(index, { playerName: "p2" }), "top10");
    assert.equal(badges.nameBadgeFor(index, { discordId: "110" }), "top10"); // p10 wins the tie
    assert.equal(badges.nameBadgeFor(index, { playerName: "P3" }), "top10"); // any case
    assert.equal(badges.nameBadgeFor(index, { playerName: "p11" }), null);
  });

  it("everyone else has no badge above Verified", () => {
    assert.equal(badges.nameBadgeFor(index, { playerName: "p1staff" }), null);
    assert.equal(badges.nameBadgeFor(index, {}), null);
  });
});

describe("equipped badges", () => {
  it("take Verified's place, the first one equipped wins", () => {
    assert.deepEqual(badges.nameBadgeFor(index, { playerName: "Collector" }), {
      name: "Gold Cup",
      asset: "/badges/gold-cup.png",
    });
    assert.deepEqual(badges.nameBadgeFor(index, { discordId: "501" }), {
      name: "Gold Cup",
      asset: "/badges/gold-cup.png",
    });
  });

  it("don't beat the Mod Pin or Top 10", () => {
    assert.equal(badges.nameBadgeFor(index, { playerName: "Mod" }), "staff");
    assert.equal(badges.nameBadgeFor(index, { playerName: "p2" }), "top10");
  });

  it("follow the player id when the inventory row has an old name", () => {
    const founder = { name: "Founder", asset: "/badges/founder.png" };
    assert.deepEqual(badges.nameBadgeFor(index, { playerName: "Renamed" }), founder);
    assert.deepEqual(badges.nameBadgeFor(index, { discordId: "777" }), founder);
  });

  it("only count when equipped, and keep a missing image as null", () => {
    assert.equal(badges.nameBadgeFor(index, { playerName: "Owner" }), null);
    assert.deepEqual(badges.nameBadgeFor(index, { playerName: "NoArt" }), { name: "No Art", asset: null });
  });

  it("show a change once the cache is cleared", async () => {
    const { client } = await import("@/lib/db");
    await client.execute("UPDATE cosmetic_inventory SET equipped = 0 WHERE player_name = 'Collector' AND item_id = 1");
    const stale = await badges.badgeIndex();
    assert.equal((badges.nameBadgeFor(stale, { playerName: "Collector" }) as { name: string }).name, "Gold Cup");
    badges.forgetNameBadges();
    const fresh = await badges.badgeIndex();
    assert.equal((badges.nameBadgeFor(fresh, { playerName: "Collector" }) as { name: string }).name, "Founder");
  });
});

describe("map image file names", () => {
  it("are the map's name, lowercase, spaces as dashes", async () => {
    const { mapImageSlug } = await import("@/components/map-thumb");
    assert.equal(mapImageSlug("Dust II"), "dust-ii");
    assert.equal(mapImageSlug("de_mirage"), "mirage");
    assert.equal(mapImageSlug("Inferno"), "inferno");
  });
});
