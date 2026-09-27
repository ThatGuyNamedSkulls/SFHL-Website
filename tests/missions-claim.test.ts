/**
 * M4 (docs/WEBSITE_SECURITY_REPORT.md): a mission reward pays once per
 * player, even with parallel claims or after the player is renamed.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("missions");
let missions: typeof import("@/lib/missions");
let client: typeof import("@/lib/db").client;

async function coins(name: string) {
  const rs = await client.execute({ sql: "SELECT coins FROM players WHERE name = ?", args: [name] });
  return Number(rs.rows[0]?.coins ?? 0);
}

before(async () => {
  missions = await import("@/lib/missions");
  client = (await import("@/lib/db")).client;
  await client.execute(
    "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, placement_done INTEGER, coins INTEGER DEFAULT 0)"
  );
  await client.execute("INSERT INTO players (name, placement_done, coins) VALUES ('ana', 1, 0)");
});

after(async () => {
  await tmp.cleanup(["web_mission_claims", "coin_ledger", "players"]);
});

describe("mission claims", () => {
  it("parallel claims pay the reward once", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => missions.claimMission("ana", "s1-placements"))
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await coins("ana"), 1000);
  });

  it("a renamed player can't claim the same mission again", async () => {
    // A rename that didn't touch web_mission_claims (the old /renameplayer).
    await client.execute("UPDATE players SET name = 'ana2' WHERE name = 'ana'");
    const views = await missions.listMissionsForPlayer("ana2");
    assert.equal(views.find((m) => m.id === "s1-placements")?.claimed, true);
    const again = await missions.claimMission("ana2", "s1-placements");
    assert.equal(again.ok, false);
    assert.equal(await coins("ana2"), 1000);
  });
});
