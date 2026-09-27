/**
 * H1 (docs/WEBSITE_SECURITY_REPORT.md): the website must only ever find a
 * player by discord_id, and must never write players.discord_id. A login whose
 * display name matches an unlinked row must not be able to claim it.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("country");
let db: typeof import("@/lib/db");

async function row(name: string) {
  const rs = await db.client.execute({
    sql: "SELECT discord_id, country, discord_username FROM players WHERE name = ?",
    args: [name],
  });
  return rs.rows[0] as unknown as { discord_id: string | null; country: string | null; discord_username: string | null };
}

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
  await db.client.execute(`INSERT INTO players (name, discord_id, discord_username) VALUES
    ('Victim', NULL, NULL), ('Linked', '555', 'linked'), ('linked2', NULL, NULL)`);
});

after(async () => {
  await tmp.cleanup(["players"]);
});

describe("country is set by discord_id only", () => {
  it("an unlinked login can't set a country or claim an unlinked row", async () => {
    // Attacker's Discord id 999 has no row; their display name would be "Victim".
    assert.equal(await db.setPlayerCountry("999", "pt"), false);
    const v = await row("Victim");
    assert.equal(v.discord_id, null);
    assert.equal(v.country, null);
    assert.equal(await db.getPlayerCountry("999"), null);
  });

  it("a linked player sets their own country", async () => {
    assert.equal(await db.setPlayerCountry("555", "PT"), true);
    assert.equal((await row("Linked")).country, "pt");
    assert.equal(await db.getPlayerCountry("555"), "pt");
  });

  it("the login identity refresh never stamps a discord_id onto another row", async () => {
    // "Linked" and "linked2" differ only by case; the refresh must touch the
    // discord_id-matched row only.
    await db.setPlayerDiscordIdentity("555", "newhandle", "https://cdn.discordapp.com/x.png");
    assert.equal((await row("Linked")).discord_username, "newhandle");
    const other = await row("linked2");
    assert.equal(other.discord_id, null);
    assert.equal(other.discord_username, null);
  });
});
