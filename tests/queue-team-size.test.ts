/**
 * The website follows the bot's /gamemode: getQueueTeamSize reads the team
 * size the bot saved in bot_state.queue_mode (2v2, 3v3 or 5v5).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("queue-team-size");
let db: typeof import("@/lib/db");

before(async () => {
  db = await import("@/lib/db");
  await db.client.execute("CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT)");
});

after(async () => {
  await tmp.cleanup(["bot_state"]);
});

async function save(value: string) {
  await db.client.execute({
    sql: "INSERT OR REPLACE INTO bot_state (key, value) VALUES ('queue_mode', ?)",
    args: [value],
  });
}

describe("live queue team size", () => {
  it("is 5v5 until the bot saves a format", async () => {
    assert.equal(await db.getQueueTeamSize(), 5);
  });
  it("follows /gamemode", async () => {
    for (const size of [2, 3, 5]) {
      await save(String(size));
      assert.equal(await db.getQueueTeamSize(), size);
    }
  });
  it("ignores formats /gamemode doesn't offer", async () => {
    await save("1");
    assert.equal(await db.getQueueTeamSize(), 5);
    await save("junk");
    assert.equal(await db.getQueueTeamSize(), 5);
  });
});
