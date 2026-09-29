/**
 * CT / T per team (lib/lobby resolveTeamSides) and the avatar fallback for a
 * dead Discord picture link (lib/avatar-fallback).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";
import { avatarFallbackFor, defaultDiscordAvatar } from "@/lib/avatar-fallback";

const tmp = createTempDb("team-sides");
let resolveTeamSides: typeof import("@/lib/lobby").resolveTeamSides;

before(async () => {
  ({ resolveTeamSides } = await import("@/lib/lobby"));
});

after(async () => {
  await tmp.cleanup([]);
});

describe("team sides", () => {
  it("is unknown until a side is picked", () => {
    assert.equal(resolveTeamSides({}), null);
    assert.equal(resolveTeamSides({ side: null, teamSides: null }), null);
  });
  it("uses the bot's stored sides", () => {
    assert.deepEqual(resolveTeamSides({ teamSides: { "1": "T", "2": "CT" } }), { team1: "T", team2: "CT" });
  });
  it("works them out from the pick straight away", () => {
    assert.deepEqual(resolveTeamSides({ side: { name: "CT", team: 1 } }), { team1: "CT", team2: "T" });
    assert.deepEqual(resolveTeamSides({ side: { name: "CT", team: 2 } }), { team1: "T", team2: "CT" });
    assert.deepEqual(resolveTeamSides({ side: { name: "T", team: 1 } }), { team1: "T", team2: "CT" });
  });
});

describe("avatar fallback", () => {
  const id = "123456789012345678";
  it("turns a dead Discord avatar into that account's default avatar", () => {
    assert.equal(avatarFallbackFor(`https://cdn.discordapp.com/avatars/${id}/abc123.png?size=256`), defaultDiscordAvatar(id));
    assert.equal(
      avatarFallbackFor(`https://cdn.discordapp.com/guilds/99999999999999999/users/${id}/avatars/x.png`),
      defaultDiscordAvatar(id)
    );
  });
  it("uses a generic Discord avatar when the link has no account id", () => {
    assert.equal(avatarFallbackFor("/api/avatar/123.png"), "https://cdn.discordapp.com/embed/avatars/0.png");
    assert.equal(avatarFallbackFor(null), "https://cdn.discordapp.com/embed/avatars/0.png");
  });
  it("picks one of Discord's six default avatars", () => {
    assert.match(defaultDiscordAvatar(id), /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });
});
