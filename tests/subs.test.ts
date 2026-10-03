/**
 * Substitute slots on the website: the band schedule must match the bot's
 * `[elo.sub]` (open to everyone at 5:00), and placement players may sub,
 * held to the band by their hidden placement rating — which is never shown.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("subs");
let subs: typeof import("@/lib/subs");
let client: typeof import("@/lib/db").client;

before(async () => {
  subs = await import("@/lib/subs");
  client = (await import("@/lib/db")).client;
  await client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT, country TEXT,
    total_kills INTEGER, total_deaths INTEGER, total_assists INTEGER, kd_ratio REAL,
    total_mvps INTEGER, total_score INTEGER, total_headshot_percentage REAL, avg_hs_percent REAL,
    matches_played INTEGER, matches_won INTEGER, peak_elo INTEGER, total_play_time INTEGER,
    roblox_avatar_image TEXT, placement_done INTEGER DEFAULT 0, placement_games_played INTEGER,
    discord_id TEXT, discord_username TEXT, discord_avatar TEXT, mm_access INTEGER DEFAULT 0,
    mmr REAL DEFAULT NULL)`);
  await client.execute(`INSERT INTO players (name, discord_id, elo, rank, placement_done, mmr) VALUES
    ('placing', '201', 0, 'Unranked', 0, 1340),
    ('fresh',   '202', 0, 'Unranked', 0, NULL),
    ('faroff',  '203', 0, 'Unranked', 0, 1900),
    ('ranked',  '204', 1500, 'A1', 1, NULL)`);
  await client.execute(`CREATE TABLE sub_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, guild_id TEXT,
    region TEXT, mode TEXT, team INTEGER NOT NULL, map_name TEXT, leaver_name TEXT NOT NULL,
    leaver_discord_id TEXT, sub_name TEXT, sub_player_id INTEGER, sub_discord_id TEXT,
    status TEXT NOT NULL DEFAULT 'open', target_elo INTEGER, swap_score TEXT,
    claim_source TEXT, applied INTEGER NOT NULL DEFAULT 0, match_id INTEGER,
    created_at INTEGER NOT NULL, filled_at INTEGER)`);
});

after(async () => {
  await tmp.cleanup(["sub_requests", "players", "player_bans"]);
});

async function openSlot(openedSecondsAgo: number, hidden = false): Promise<void> {
  await client.execute("DELETE FROM sub_requests");
  await client.execute({
    sql: `INSERT INTO sub_requests (channel_id, team, leaver_name, leaver_discord_id, target_elo, target_hidden, created_at)
          VALUES ('555', 1, 'leaver', '42', 1300, ?, ?)`,
    args: [hidden ? 1 : 0, Date.now() - openedSecondsAgo * 1000],
  });
}

async function viewAs(name: string, discordId: string) {
  const [view] = await subs.listSubRequests({ discordId, playerName: name, inGuild: true });
  return view;
}

describe("schema", () => {
  it("adds target_hidden to a sub_requests table from before it existed", async () => {
    await subs.listSubRequests(null);
    const cols = (await client.execute("PRAGMA table_info(sub_requests)")).rows.map((r) => String(r.name));
    assert.ok(cols.includes("target_hidden"));
  });
});

describe("band schedule", () => {
  it("opens to everyone at 5:00, matching the CBL bot's band_steps", () => {
    assert.equal(subs.bandFor(0), 100);
    assert.equal(subs.bandFor(149), 200);
    assert.equal(subs.bandFor(299), 350);
    assert.equal(subs.bandFor(300), null);
    assert.equal(subs.secondsUntilEligible(2400, 1200, 0), 300);
  });
});

describe("placement players as substitutes", () => {
  it("lets them claim when their hidden rating is inside the band", async () => {
    await openSlot(0);
    assert.equal((await viewAs("placing", "201")).eligible, true);
    assert.equal((await viewAs("fresh", "202")).eligible, true, "never played = the 1200 seed");
  });

  it("holds them to the band without printing the hidden rating", async () => {
    await openSlot(0);
    const view = await viewAs("faroff", "203");
    assert.equal(view.eligible, false);
    assert.match(view.reason ?? "", /placement rating/);
    assert.doesNotMatch(view.reason ?? "", /1900/);
    assert.ok(Math.abs((view.eligibleInSeconds ?? 0) - 300) < 5, "eligible when it opens at 5:00");
    assert.match((await viewAs("ranked", "204")).reason ?? "", /Your Elo \(1500\)/);
  });

  it("lets anyone in once the slot has been open for 5 minutes", async () => {
    await openSlot(295);
    assert.equal((await viewAs("faroff", "203")).eligible, false);
    await openSlot(305);
    assert.equal((await viewAs("faroff", "203")).eligible, true);
  });
});

describe("a banned player (/player ban)", () => {
  it("can't claim a slot; a lifted ban or no bans table blocks nobody", async () => {
    const { bannedDiscordIds } = await import("@/lib/bans");
    assert.equal((await bannedDiscordIds(["201"])).size, 0, "no player_bans table yet");
    await client.execute(`CREATE TABLE player_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT NOT NULL, roblox_user_id INTEGER,
      player_name TEXT, reason TEXT NOT NULL, banned_by TEXT NOT NULL, banned_at TEXT NOT NULL,
      lifted_at TEXT, lifted_by TEXT)`);
    await client.execute(`INSERT INTO player_bans (discord_id, reason, banned_by, banned_at, lifted_at) VALUES
      ('201', 'cheating', 'staff', '2026-10-03 18:00:00', NULL),
      ('204', 'old one', 'staff', '2026-09-01 00:00:00', '2026-09-02 00:00:00')`);
    assert.deepEqual([...(await bannedDiscordIds(["201", "204", "202"]))], ["201"]);

    await openSlot(0);
    const slot = Number((await client.execute("SELECT id FROM sub_requests")).rows[0].id);
    const res = await subs.claimSubRequest({ discordId: "201", playerName: "placing", inGuild: true }, slot);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /banned/);
    const open = await client.execute("SELECT status FROM sub_requests WHERE id = ?", [slot]);
    assert.equal(String(open.rows[0].status), "open");
  });
});

describe("an unranked leaver's slot", () => {
  it("is banded on their hidden rating but never sends it — it says Unranked", async () => {
    await openSlot(0, true);
    const view = await viewAs("ranked", "204"); // 1500, 200 from the hidden 1300
    assert.equal(view.targetElo, null);
    assert.equal(view.targetHidden, true);
    assert.equal(view.eligible, false);
    assert.match(view.reason ?? "", /\(Unranked\)/);
    assert.doesNotMatch(view.reason ?? "", /1300/);
    assert.equal((await viewAs("placing", "201")).eligible, true, "1340 is within 100 of 1300");
  });
});
