/**
 * Website side of the queue ready check: what the popup reads and the accept
 * rules (same as the bot's core/ready_checks.py).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("readycheck");
let rc: typeof import("@/lib/ready-checks");
let client: typeof import("@/lib/db").client;

/** Open a check the way the bot does. */
async function openCheck(id: string, players: string[], opts: { deadline?: number; status?: string; declined?: string[]; finishedAt?: number | null } = {}) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO ready_checks (id, region, mode, player_ids, deadline, status, declined_ids, created_at, finished_at)
          VALUES (?, 'EU', 'standard', ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      JSON.stringify(players),
      opts.deadline ?? now + 20_000,
      opts.status ?? "pending",
      JSON.stringify(opts.declined ?? []),
      now,
      opts.finishedAt ?? null,
    ],
  });
}

before(async () => {
  rc = await import("@/lib/ready-checks");
  client = (await import("@/lib/db")).client;
  await rc.myReadyCheck("0"); // creates the tables
});

after(async () => {
  await tmp.cleanup(["ready_check_accepts", "ready_checks"]);
});

describe("ready check (website)", () => {
  it("shows a pending check with the time left and nobody accepted", async () => {
    await openCheck("c1", ["101", "102", "103"]);
    const mine = await rc.myReadyCheck("101");
    assert.ok(mine);
    assert.equal(mine.status, "pending");
    assert.equal(mine.total, 3);
    assert.equal(mine.accepted, 0);
    assert.equal(mine.iAccepted, false);
    assert.ok(mine.remainingMs > 15_000 && mine.remainingMs <= 20_000);
  });

  it("accepting counts once and only for players in the check", async () => {
    assert.equal(await rc.acceptReadyCheck("c1", "101"), "accepted");
    assert.equal(await rc.acceptReadyCheck("c1", "101"), "already");
    assert.equal(await rc.acceptReadyCheck("c1", "999"), "not_in_check");
    const mine = await rc.myReadyCheck("101");
    assert.equal(mine?.accepted, 1);
    assert.equal(mine?.iAccepted, true);
    assert.equal((await rc.myReadyCheck("102"))?.iAccepted, false);
  });

  it("does not match a longer id that contains yours", async () => {
    assert.equal(await rc.myReadyCheck("10"), null);
  });

  it("refuses accepts after the 20 seconds or once the check is over", async () => {
    await openCheck("c2", ["201"], { deadline: Date.now() - 1 });
    assert.equal(await rc.acceptReadyCheck("c2", "201"), "expired");
    await openCheck("c3", ["301"], { status: "started", finishedAt: Date.now() });
    assert.equal(await rc.acceptReadyCheck("c3", "301"), "closed");
    assert.equal(await rc.acceptReadyCheck("nope", "301"), "closed");
  });

  it("tells a removed player they were removed, and others they're still queued", async () => {
    await openCheck("c4", ["401", "402"], {
      status: "failed",
      declined: ["402"],
      finishedAt: Date.now(),
    });
    assert.equal((await rc.myReadyCheck("402"))?.iWasRemoved, true);
    assert.equal((await rc.myReadyCheck("401"))?.iWasRemoved, false);
  });

  it("forgets finished checks after a minute", async () => {
    await openCheck("c5", ["501"], { status: "failed", finishedAt: Date.now() - 120_000 });
    await client.execute("UPDATE ready_checks SET created_at = ? WHERE id = 'c5'", [Date.now() - 120_000]);
    assert.equal(await rc.myReadyCheck("501"), null);
  });
});
