/**
 * Pro Matchmaking on the website: the S2+ access rule (in at 1900, kept until
 * below 1850) and the "pro" queue mode.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("pro");
let pro: typeof import("@/lib/pro");
let modes: typeof import("@/lib/queue-modes");
let client: typeof import("@/lib/db").client;

before(async () => {
  pro = await import("@/lib/pro");
  modes = await import("@/lib/queue-modes");
  client = (await import("@/lib/db")).client;
});

after(async () => {
  await tmp.cleanup(["players"]);
});

describe("pro access rule", () => {
  it("is gained at 1900 and kept until below 1850", () => {
    assert.equal(pro.PRO_MIN_ELO, 1900);
    assert.equal(pro.PRO_KEEP_ELO, 1850);
    assert.equal(pro.proAccessAfter(1900, true, false), true);
    assert.equal(pro.proAccessAfter(1899, true, false), false);
    assert.equal(pro.proAccessAfter(1860, true, true), true);
    assert.equal(pro.proAccessAfter(1860, true, false), false);
    assert.equal(pro.proAccessAfter(1849, true, true), false);
    assert.equal(pro.proAccessAfter(2300, false, true), false, "placements must be done");
  });
});

describe("pro access from the database", () => {
  it("falls back to the 1900 rule before the bot adds pro_access", async () => {
    await client.execute(
      "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, discord_id TEXT, elo INTEGER, placement_done INTEGER)"
    );
    await client.execute(
      "INSERT INTO players (name, discord_id, elo, placement_done) VALUES ('a', '1', 1950, 1), ('b', '2', 1870, 1)"
    );
    const got = await pro.proAccessByDiscordId(["1", "2", "404"]);
    assert.deepEqual(Object.fromEntries(got), { "1": true, "2": false, "404": false });
  });

  it("uses the bot's flag for the 1850–1899 grace band", async () => {
    await client.execute("ALTER TABLE players ADD COLUMN pro_access INTEGER DEFAULT 0");
    await client.execute("UPDATE players SET pro_access = 1 WHERE name = 'b'");
    assert.equal(await pro.hasProAccess("2"), true);
    await client.execute("UPDATE players SET elo = 1840 WHERE name = 'b'");
    assert.equal(await pro.hasProAccess("2"), false, "below 1850 loses access even with the flag");
  });
});

describe("pro queue mode", () => {
  it("parses and labels Pro Matchmaking", () => {
    assert.equal(modes.parseQueueMode("pro"), "pro");
    assert.equal(modes.parseQueueMode("Pro Matchmaking"), "pro");
    assert.equal(modes.isQueueMode("pro"), true);
    // Pro Matchmaking is switched off; its old games keep their label, marked old.
    assert.equal(modes.queueModeLabel("pro"), modes.PRO_QUEUE_ENABLED ? "Pro Matchmaking" : "Pro Matchmaking (old)");
    assert.equal(modes.queueModeLabel("super"), "Super Match");
    assert.equal(modes.queueModeLabel(null), "Standard Match");
  });
});
