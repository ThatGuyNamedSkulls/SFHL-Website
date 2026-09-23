/**
 * Party chat: members only, the `after` cursor used for polling, length
 * limits, deletion rights, and the 24h sweep.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("partychat");
let chat: typeof import("@/lib/party-chat");
let client: typeof import("@/lib/db").client;

const PARTY = "party-test-1";
const leader = { discordId: "201", username: "lead", playerName: "lead", avatar: null };
const member = { discordId: "202", username: "mate", playerName: "mate", avatar: null };
const outsider = { discordId: "299", username: "out", playerName: "out", avatar: null };

function partyRow(members: { discordId: string; username: string }[]) {
  const now = Date.now();
  return JSON.stringify({
    id: PARTY, name: "Test", game: "SF", gameMode: "5v5", matchType: "Standard",
    region: "EU", leaderId: leader.discordId, maxSize: 5, minSkill: "", maxSkill: "",
    language: "", countries: "", verifiedOnly: false, voiceRequired: false,
    isPrivate: true, createdAt: now, updatedAt: now,
    members: members.map((m) => ({
      discordId: m.discordId, username: m.username, playerName: m.username,
      avatar: null, rank: "UNRANKED", elo: 0, country: null,
    })),
  });
}

before(async () => {
  chat = await import("@/lib/party-chat");
  client = (await import("@/lib/db")).client;
  // Production has the bot's players table; chat rows look up player_id from it.
  await client.execute("CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT UNIQUE)");
  await client.execute("INSERT INTO players (name) VALUES ('lead'), ('mate')");
  const { getParties } = await import("@/lib/parties");
  await getParties(); // creates web_parties
  await client.execute({
    sql: "INSERT INTO web_parties (id, data, updated_at) VALUES (?, ?, ?)",
    args: [PARTY, partyRow([leader, member]), Date.now()],
  });
});

after(async () => {
  await tmp.cleanup(["web_party_chat", "web_parties", "web_queue", "players"]);
});

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof chat.PartyChatError, String(e));
    assert.equal((e as InstanceType<typeof chat.PartyChatError>).status, status);
    return true;
  });
}

describe("party chat", () => {
  let first = 0;

  it("lets members post and read, oldest first", async () => {
    const a = await chat.postPartyChat(PARTY, leader, "  hello team  ");
    const b = await chat.postPartyChat(PARTY, member, "hi!");
    first = a.id;
    assert.equal(a.message, "hello team", "trimmed");
    const pid = await client.execute({
      sql: "SELECT player_id FROM web_party_chat WHERE id = ?",
      args: [a.id],
    });
    assert.ok(Number(pid.rows[0].player_id) > 0, "linked to the player row");
    const rows = await chat.listPartyChat(PARTY);
    assert.deepEqual(rows.map((r) => r.message), ["hello team", "hi!"]);
    assert.ok(b.id > a.id);
  });

  it("polls only newer messages with the after cursor", async () => {
    const newer = await chat.listPartyChat(PARTY, first);
    assert.deepEqual(newer.map((r) => r.message), ["hi!"]);
    const none = await chat.listPartyChat(PARTY, newer[newer.length - 1].id);
    assert.equal(none.length, 0);
  });

  it("blocks people outside the party (403) and unknown parties (404)", async () => {
    await rejects(chat.postPartyChat(PARTY, outsider, "let me in"), 403);
    await rejects(chat.assertPartyMember(PARTY, outsider.discordId), 403);
    await rejects(chat.postPartyChat("no-such-party", leader, "hi"), 404);
  });

  it("enforces the 1–250 character limit", async () => {
    await rejects(chat.postPartyChat(PARTY, leader, "   "), 400);
    await rejects(chat.postPartyChat(PARTY, leader, "x".repeat(chat.PARTY_CHAT_MAX_LENGTH + 1)), 400);
    const ok = await chat.postPartyChat(PARTY, leader, "x".repeat(chat.PARTY_CHAT_MAX_LENGTH));
    assert.equal(ok.message.length, chat.PARTY_CHAT_MAX_LENGTH);
  });

  it("authors delete their own messages; the leader can delete any", async () => {
    const mine = await chat.postPartyChat(PARTY, member, "oops");
    const theirs = await chat.postPartyChat(PARTY, leader, "leader msg");
    await rejects(chat.deletePartyChat(PARTY, member.discordId, theirs.id), 403);
    await chat.deletePartyChat(PARTY, member.discordId, mine.id);
    const byLeader = await chat.postPartyChat(PARTY, member, "moderate me");
    await chat.deletePartyChat(PARTY, leader.discordId, byLeader.id);
    const ids = (await chat.listPartyChat(PARTY)).map((r) => r.id);
    assert.ok(!ids.includes(mine.id) && !ids.includes(byLeader.id) && ids.includes(theirs.id));
    await rejects(chat.deletePartyChat(PARTY, leader.discordId, 999_999), 404);
  });

  it("returns only the last 10 when the right bar asks for 10", async () => {
    for (let i = 1; i <= 12; i++) await chat.postPartyChat(PARTY, leader, `burst ${i}`);
    const last = await chat.listPartyChat(PARTY, 0, 10);
    assert.equal(last.length, 10);
    assert.equal(last[last.length - 1].message, "burst 12", "newest last");
    assert.equal(last[0].message, "burst 3", "oldest of the last ten first");
  });

  it("keeps each party's chat separate", async () => {
    assert.equal((await chat.listPartyChat("another-party")).length, 0);
  });

  it("sweeps messages older than 24 hours on the next post", async () => {
    await client.execute({
      sql: "UPDATE web_party_chat SET created_at = ? WHERE id = ?",
      args: [Date.now() - 25 * 60 * 60 * 1000, first],
    });
    await chat.postPartyChat(PARTY, leader, "fresh");
    const ids = (await chat.listPartyChat(PARTY)).map((r) => r.id);
    assert.ok(!ids.includes(first), "stale message removed");
  });

  it("a player who left the party loses access", async () => {
    await client.execute({
      sql: "UPDATE web_parties SET data = ? WHERE id = ?",
      args: [partyRow([leader]), PARTY],
    });
    await rejects(chat.postPartyChat(PARTY, member, "still here?"), 403);
  });
});
