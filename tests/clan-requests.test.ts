/**
 * Requests to join an invite-only clan: a player asks, the owner (or a role
 * that can invite) accepts or declines, and both sides are notified.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("clan-requests");
let clubs: typeof import("@/lib/clubs");
let client: typeof import("@/lib/db").client;

const person = (discordId: string, playerName: string) => ({
  discordId,
  username: playerName.toLowerCase(),
  playerName,
  avatar: null,
});
const OWNER = person("1", "Owner");
const MEMBER = person("2", "Member");
const ASKER = person("3", "Asker");
const DECLINED = person("4", "Declined");
const CANCELLER = person("5", "Canceller");
const LATE = person("6", "Late");

let clanId = "";

async function privateClan(name: string, tag: string) {
  const club = await clubs.createClub({ name, tag, private: true, owner: OWNER });
  return club.id;
}

async function notificationsFor(name: string) {
  const rs = await client.execute({
    sql: "SELECT type, message, ref_id FROM notifications WHERE player_name = ? ORDER BY id",
    args: [name],
  });
  return rs.rows.map((r) => ({ type: String(r.type), message: String(r.message), refId: String(r.ref_id) }));
}

async function dmCount(name: string) {
  const rs = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM discord_dm_outbox WHERE player_name = ?",
    args: [name],
  });
  return Number(rs.rows[0].n);
}

before(async () => {
  clubs = await import("@/lib/clubs");
  ({ client } = await import("@/lib/db"));
  await client.execute("CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, discord_id TEXT)");
  for (const p of [OWNER, MEMBER, ASKER, DECLINED, CANCELLER, LATE]) {
    await client.execute({ sql: "INSERT INTO players (name, discord_id) VALUES (?, ?)", args: [p.playerName, p.discordId] });
  }
  clanId = await privateClan("Night Owls", "OWLS");
  // MEMBER joins with an invite link: a plain member, who can't answer requests.
  const invited = await clubs.createInvite(clanId, OWNER.discordId);
  await clubs.joinClub(clanId, MEMBER, invited.invites[0].token);
});

after(async () => {
  await tmp.cleanup(["web_clubs", "web_club_tag_pref", "notifications", "discord_dm_outbox", "web_users", "players"]);
});

describe("clan join requests", () => {
  it("an open clan has no requests: players join it directly", async () => {
    const open = await clubs.createClub({ name: "Open Door", tag: "OPEN", owner: OWNER });
    await assert.rejects(clubs.requestToJoin(open.id, ASKER), /open: join it directly/);
  });

  it("a request is only shown to the staff; asking twice is harmless", async () => {
    const first = await clubs.requestToJoin(clanId, ASKER);
    assert.equal(first.created, true);
    const again = await clubs.requestToJoin(clanId, ASKER);
    assert.equal(again.created, false);
    assert.equal(again.club.requests.length, 1);

    const forOwner = clubs.clubForClient(again.club, OWNER.discordId);
    assert.deepEqual(forOwner.requests.map((r) => r.playerName), ["Asker"]);
    const forAsker = clubs.clubForClient(again.club, ASKER.discordId);
    assert.deepEqual(forAsker.requests, []);
    assert.equal(forAsker.requested, true);
    const forMember = clubs.clubForClient(again.club, MEMBER.discordId);
    assert.deepEqual(forMember.requests, []);
    assert.equal(forMember.requested, false);
    assert.equal("requestCooldowns" in forOwner, false); // server-only
  });

  it("notifies the owner, not plain members", async () => {
    const club = (await clubs.getClub(clanId))!;
    await clubs.notifyJoinRequest(club, club.requests[0]);
    assert.deepEqual(await notificationsFor("Owner"), [
      { type: "clan_request", message: "Asker asked to join Night Owls.", refId: `/clans/${clanId}` },
    ]);
    assert.equal(await dmCount("Owner"), 1);
    assert.deepEqual(await notificationsFor("Member"), []);
  });

  it("only the owner or a role that can invite may answer", async () => {
    await assert.rejects(
      clubs.answerJoinRequest(clanId, MEMBER.discordId, ASKER.discordId, true),
      /cannot answer join requests/
    );
  });

  it("accept makes them a member and tells them", async () => {
    const { club, request } = await clubs.answerJoinRequest(clanId, OWNER.discordId, ASKER.discordId, true);
    assert.equal(clubs.memberOf(club, ASKER.discordId)?.role, clubs.MEMBER_ROLE_ID);
    assert.deepEqual(club.requests, []);
    await clubs.notifyRequestAnswer(club, request, true, "Owner");
    assert.equal((await notificationsFor("Asker"))[0].message, "You're in! Night Owls accepted your request to join.");
    assert.equal(await dmCount("Asker"), 1);
    await assert.rejects(clubs.requestToJoin(clanId, ASKER), /already in this clan/);
    await assert.rejects(
      clubs.answerJoinRequest(clanId, OWNER.discordId, ASKER.discordId, true),
      /request is gone/
    );
  });

  it("decline makes them wait a day before asking again (bell, no DM)", async () => {
    await clubs.requestToJoin(clanId, DECLINED);
    const { club, request } = await clubs.answerJoinRequest(clanId, OWNER.discordId, DECLINED.discordId, false);
    assert.equal(clubs.memberOf(club, DECLINED.discordId), undefined);
    await clubs.notifyRequestAnswer(club, request, false, "Owner");
    assert.equal((await notificationsFor("Declined"))[0].message, "Night Owls declined your request to join.");
    assert.equal(await dmCount("Declined"), 0);
    await assert.rejects(clubs.requestToJoin(clanId, DECLINED), /again in 24 hours/);
  });

  it("cancelling makes them wait 10 minutes (no cancel/re-ask spam)", async () => {
    await clubs.requestToJoin(clanId, CANCELLER);
    const club = await clubs.cancelJoinRequest(clanId, CANCELLER.discordId);
    assert.equal(club.requests.length, 0);
    await assert.rejects(clubs.requestToJoin(clanId, CANCELLER), /again in 10 minutes/);
  });

  it("joining with an invite link, or the clan going open, clears pending requests", async () => {
    const id = await privateClan("Late Night", "LATE");
    await clubs.requestToJoin(id, LATE);
    const invited = await clubs.createInvite(id, OWNER.discordId);
    const joined = await clubs.joinClub(id, LATE, invited.invites[0].token);
    assert.deepEqual(joined.requests, []);

    await clubs.requestToJoin(id, DECLINED);
    const opened = await clubs.updateClub(id, OWNER.discordId, { private: false });
    assert.deepEqual(opened.requests, []);
  });
});
