/**
 * Overtime tie votes in the website match room (lib/overtime-votes.ts): the
 * same table and vote as Discord's /match overtimevote. A player of the match
 * votes once while it's open, the vote becomes a tie as soon as enough have,
 * time's-up shows what the bot will settle to, and old results stop showing.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("overtime-votes");
let ov: typeof import("@/lib/overtime-votes");
let client: typeof import("@/lib/db").client;

const LOBBY = "300000000000000888";
const NOW = Date.parse("2026-10-05T18:00:00Z");
const PLAYERS = ["1001", "1002", "1003", "1004"];

async function openVote(required: number, startedAt = NOW, endsAt = NOW + 120_000, lobby = LOBBY) {
  await ov.ensureOvertimeVotesTable();
  const rs = await client.execute({
    sql: `INSERT INTO overtime_votes (lobby_id, overtime, required, eligible, started_at, ends_at)
          VALUES (?, 3, ?, ?, ?, ?)`,
    args: [lobby, required, JSON.stringify(PLAYERS), startedAt, endsAt],
  });
  return Number(rs.lastInsertRowid);
}

async function rejects(promise: Promise<unknown>, message: RegExp) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof ov.OvertimeVoteError, String(e));
    assert.match((e as Error).message, message);
    return true;
  });
}

before(async () => {
  ov = await import("@/lib/overtime-votes");
  client = (await import("@/lib/db")).client;
});

after(async () => {
  await tmp.cleanup(["overtime_votes"]);
});

describe("overtime tie votes", () => {
  it("shows nothing before a vote, then the open vote to its players", async () => {
    assert.equal(await ov.overtimeVoteFor(LOBBY, "1001", NOW), null);
    await openVote(2);
    const view = await ov.overtimeVoteFor(LOBBY, "1001", NOW);
    assert.deepEqual(
      view && [view.status, view.yes, view.required, view.eligible, view.canVote, view.voted],
      ["open", 0, 2, 4, true, false]
    );
    assert.equal((await ov.overtimeVoteFor(LOBBY, "9999", NOW))?.canVote, false, "a spectator can't vote");
  });

  it("counts each player once and becomes a tie as soon as enough voted", async () => {
    const first = await ov.voteTie(LOBBY, "1001", NOW);
    assert.deepEqual([first.yes, first.voted, first.status], [1, true, "open"]);
    await rejects(ov.voteTie(LOBBY, "1001", NOW), /already voted/);
    await rejects(ov.voteTie(LOBBY, "9999", NOW), /Only this match's players/);
    const second = await ov.voteTie(LOBBY, "1002", NOW);
    assert.equal(second.status, "tie");
    const row = (await client.execute({ sql: "SELECT status, yes FROM overtime_votes WHERE lobby_id = ?", args: [LOBBY] })).rows[0];
    assert.equal(row.status, "tie", "saved for the bot to announce");
    assert.deepEqual(JSON.parse(String(row.yes)), ["1001", "1002"]);
    await rejects(ov.voteTie(LOBBY, "1003", NOW), /no tie vote open/);
  });

  it("after time's up shows what the bot will settle to, and old results go away", async () => {
    const other = "300000000000000999";
    await openVote(3, NOW - 130_000, NOW - 10_000, other);
    const view = await ov.overtimeVoteFor(other, "1001", NOW);
    assert.equal(view?.status, "no_tie");
    await rejects(ov.voteTie(other, "1001", NOW), /no tie vote open/);
    assert.equal(await ov.overtimeVoteFor(other, "1001", NOW + 11 * 60_000), null, "a result shows for 10 minutes");
  });
});
