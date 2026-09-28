/**
 * H4 / M1 / M5 / L4 (docs/WEBSITE_SECURITY_REPORT.md): user text can't become
 * links or pings in bot messages, party input is normalized, the shared rate
 * limiter counts per window, and player-caused bot DMs are capped.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("abuse");
let safe: typeof import("@/lib/discord-safe");
let rules: typeof import("@/lib/party-rules");
let limits: typeof import("@/lib/rate-limit");
let social: typeof import("@/lib/social");
let client: typeof import("@/lib/db").client;

before(async () => {
  safe = await import("@/lib/discord-safe");
  rules = await import("@/lib/party-rules");
  limits = await import("@/lib/rate-limit");
  social = await import("@/lib/social");
  client = (await import("@/lib/db")).client;
  await client.execute("CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, discord_id TEXT)");
  await client.execute(
    "INSERT INTO players (name, discord_id) VALUES ('victim', '500'), ('spammer', '600'), ('other', '700')"
  );
});

after(async () => {
  await tmp.cleanup([
    "discord_dm_outbox", "notifications", "web_users", "friendships", "friend_requests",
    "party_invites", "web_rate_limits", "players",
  ]);
});

describe("discordSafe", () => {
  it("defuses masked links, raw links, invites and pings", () => {
    const out = safe.discordSafe("[claim](https://evil.example) discord.gg/abc @everyone <@123>");
    assert.ok(!/\[claim\]\(/.test(out), "no masked link");
    assert.ok(!out.includes("https://"), "no clickable scheme");
    assert.ok(!out.includes("discord.gg/"), "no invite link");
    assert.ok(!out.includes("@everyone"), "no @everyone");
    assert.ok(!out.includes("<@"), "no user mention");
  });

  it("trims to the max length", () => {
    assert.ok(safe.discordSafe("x".repeat(100), 10).length <= 10);
  });
});

describe("party fields", () => {
  it("forces every field to a known string", () => {
    const f = rules.cleanPartyFields({
      name: { evil: 1 },
      game: ["x"],
      matchType: "Hacked",
      region: 5,
      minSkill: "Z",
      maxSkill: "S2",
      language: "Klingon",
      countries: "x".repeat(500),
      vibe: { a: 1 },
      verifiedOnly: "yes",
    });
    assert.equal(f.name, "New Party");
    assert.equal(f.game, "Counter Blox");
    assert.equal(f.matchType, "Standard");
    assert.equal(f.region, "EU");
    assert.equal(f.minSkill, "D");
    assert.equal(f.maxSkill, "S2");
    assert.equal(f.language, "Any");
    assert.equal(f.countries.length, 40);
    assert.equal(f.vibe, "Balanced");
    assert.equal(f.verifiedOnly, false);
    for (const v of Object.values(f)) assert.ok(typeof v === "string" || typeof v === "boolean");
  });

  it("rejects a rude party name", () => {
    assert.throws(() => rules.cleanPartyFields({ name: "fuck" }), rules.PartyInputError);
  });
});

describe("rate limiter", () => {
  it("allows `limit` hits per window, then refuses", async () => {
    const key = `test:${Date.now()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limits.rateLimit(key, 3, 60_000));
    assert.deepEqual(results, [true, true, true, false]);
  });

  it("counts correctly under parallel hits", async () => {
    const key = `test-par:${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => limits.rateLimit(key, 4, 60_000)));
    assert.equal(results.filter(Boolean).length, 4);
  });
});

describe("bot DM caps", () => {
  it("a player gets at most 3 player-caused DMs an hour; system DMs aren't capped", async () => {
    const queued = [];
    for (let i = 0; i < 5; i++) queued.push(await social.enqueueDM("victim", `invite ${i}`, "spammer"));
    assert.deepEqual(queued, [true, true, true, false, false]);
    assert.equal(await social.enqueueDM("victim", "system notice"), true);
    const rs = await client.execute("SELECT discord_id, from_player FROM discord_dm_outbox WHERE player_name = 'victim'");
    assert.equal(rs.rows.length, 4);
    // Addressed by the bot-verified id, not left for name lookup.
    assert.ok(rs.rows.every((r) => String(r.discord_id) === "500"));
  });

  it("one player can cause at most 20 DMs an hour", async () => {
    await client.execute("DELETE FROM discord_dm_outbox");
    let sent = 0;
    for (let i = 0; i < 25; i++) {
      // A fresh recipient each time so only the sender cap applies.
      await client.execute({ sql: "INSERT OR IGNORE INTO players (name, discord_id) VALUES (?, ?)", args: [`p${i}`, `9${i}`] });
      if (await social.enqueueDM(`p${i}`, "hi", "spammer")) sent++;
    }
    assert.equal(sent, social.DM_PER_SENDER_PER_HOUR);
  });
});
