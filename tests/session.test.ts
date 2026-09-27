/**
 * M2 (docs/WEBSITE_SECURITY_REPORT.md): sessions follow the account's CURRENT
 * player link, can be revoked ("log out everywhere"), and can't be refreshed
 * past 30 days after sign-in.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("session");
let auth: typeof import("@/lib/auth");
let store: typeof import("@/lib/session-store");
let client: typeof import("@/lib/db").client;

const DAY = 24 * 60 * 60 * 1000;
const base = {
  discordId: "777",
  username: "OldName",
  avatar: null,
  discriminator: "0",
  playerName: "OldName",
  inGuild: true,
};

before(async () => {
  auth = await import("@/lib/auth");
  store = await import("@/lib/session-store");
  client = (await import("@/lib/db")).client;
  await client.execute("CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, discord_id TEXT)");
  await client.execute("INSERT INTO players (name, discord_id) VALUES ('NewName', '777')");
});

after(async () => {
  await tmp.cleanup(["players", "web_session_epochs"]);
});

describe("session checks", () => {
  it("uses the live player name, not the one baked into the cookie", async () => {
    store.forgetLiveIdentity("777");
    const s = await auth.validateSessionClaims({ ...base, authAt: Date.now(), epoch: 0 });
    assert.equal(s?.playerName, "NewName");
  });

  it("an unlinked account has no player, whatever the cookie says", async () => {
    store.forgetLiveIdentity("888");
    const s = await auth.validateSessionClaims({ ...base, discordId: "888", authAt: Date.now(), epoch: 0 });
    assert.ok(s);
    assert.equal(s!.playerName, null);
  });

  it("refuses a session signed in more than 30 days ago", async () => {
    const s = await auth.validateSessionClaims({ ...base, authAt: Date.now() - 31 * DAY, epoch: 0 });
    assert.equal(s, null);
  });

  it("old cookies without authAt are capped from their issue time", async () => {
    const iat = Math.floor((Date.now() - 40 * DAY) / 1000);
    assert.equal(await auth.validateSessionClaims({ ...base, iat, epoch: 0 } as never), null);
  });

  it("log out everywhere invalidates older sessions but not new ones", async () => {
    store.forgetLiveIdentity("777");
    const before = await auth.validateSessionClaims({ ...base, authAt: Date.now(), epoch: 0 });
    assert.ok(before);
    await store.bumpSessionEpoch("777");
    assert.equal(await auth.validateSessionClaims({ ...base, authAt: Date.now(), epoch: 0 }), null);
    assert.ok(await auth.validateSessionClaims({ ...base, authAt: Date.now(), epoch: 1 }));
  });

  it("a signed token round-trips with authAt and epoch", async () => {
    const token = await auth.encodeSession({ ...base, authAt: 123, epoch: 4 });
    const claims = await auth.decodeSession(token);
    assert.equal(claims?.authAt, 123);
    assert.equal(claims?.epoch, 4);
  });
});
