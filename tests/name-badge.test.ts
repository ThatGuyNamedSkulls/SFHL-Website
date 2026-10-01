/**
 * The badge next to a name: Mod Pin (Match Staff) beats Top 10, which beats
 * Verified. Top 10 is the bot's rule: highest Elo (> 0), then most wins.
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
  index = await badges.badgeIndex();
});

after(async () => {
  await tmp.cleanup(["players"]);
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

describe("map image file names", () => {
  it("are the map's name, lowercase, spaces as dashes", async () => {
    const { mapImageSlug } = await import("@/components/map-thumb");
    assert.equal(mapImageSlug("Dust II"), "dust-ii");
    assert.equal(mapImageSlug("de_mirage"), "mirage");
    assert.equal(mapImageSlug("Inferno"), "inferno");
  });
});
