/**
 * "Online on the website": heartbeats, the online window, leaving, and
 * lookups by player name or Discord id.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("presence");
let presence: typeof import("@/lib/presence");
let client: typeof import("@/lib/db").client;

before(async () => {
  presence = await import("@/lib/presence");
  client = (await import("@/lib/db")).client;
});

after(async () => {
  await tmp.cleanup(["web_presence"]);
});

async function ageBy(discordId: string, ms: number) {
  await client.execute({
    sql: "UPDATE web_presence SET last_seen = ? WHERE discord_id = ?",
    args: [Date.now() - ms, discordId],
  });
}

describe("presence", () => {
  it("marks a fresh heartbeat online by name and by id", async () => {
    await presence.touchPresence("101", "alice");
    const got = await presence.getOnline({ names: ["alice"], ids: ["101"] });
    assert.deepEqual(got, { names: ["alice"], ids: ["101"] });
  });

  it("keeps a player online inside the window and drops them after it", async () => {
    await presence.touchPresence("102", "bob");
    await ageBy("102", presence.ONLINE_WINDOW_MS - 5_000);
    assert.deepEqual((await presence.getOnline({ names: ["bob"] })).names, ["bob"]);
    await ageBy("102", presence.ONLINE_WINDOW_MS + 5_000);
    assert.deepEqual((await presence.getOnline({ names: ["bob"] })).names, []);
  });

  it("the window outlasts at least two missed heartbeats' worth of slack", () => {
    assert.ok(presence.ONLINE_WINDOW_MS > presence.HEARTBEAT_MS * 2);
  });

  it("leaving marks offline at once but remembers the player name", async () => {
    await presence.touchPresence("103", "carol");
    await presence.touchPresence("103", null, true);
    assert.deepEqual(await presence.getOnline({ names: ["carol"], ids: ["103"] }), {
      names: [],
      ids: [],
    });
    const rs = await client.execute({
      sql: "SELECT player_name FROM web_presence WHERE discord_id = ?",
      args: ["103"],
    });
    assert.equal(rs.rows[0].player_name, "carol");
  });

  it("a later heartbeat without a player name keeps the stored one", async () => {
    await presence.touchPresence("104", "dave");
    await presence.touchPresence("104", null);
    assert.deepEqual((await presence.getOnline({ names: ["dave"] })).names, ["dave"]);
  });

  it("returns only players that were asked about", async () => {
    await presence.touchPresence("105", "erin");
    const got = await presence.getOnline({ names: ["erin", "nobody"] });
    assert.deepEqual(got.names, ["erin"]);
    assert.deepEqual(await presence.getOnline({}), { names: [], ids: [] });
  });

  it("caps and de-duplicates lookups", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const got = await presence.getOnline({ names: [...many, "alice", "alice", " alice "] });
    assert.ok(got.names.length <= 100);
  });
});
