/**
 * Discord post markup shown on the website: role, channel and user mentions
 * by name instead of raw ids.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMentions, segmentsToText, type MentionLookup } from "@/lib/discord-mentions";

const lookup: MentionLookup = {
  roles: new Map([
    ["1523016656161603584", { name: "Tournament Players", color: 0xff5500 }],
    ["42", { name: "Plain", color: 0 }],
  ]),
  channels: new Map([["1280464713557344391", "sign-ups"]]),
  users: new Map([["7", "Skulls"]]),
  guildId: "973987866336190484",
};

describe("discord mentions", () => {
  it("shows the role and channel names from the reported post", () => {
    const segs = parseMentions(
      "ok done with it <@&1523016656161603584> join up on <#1280464713557344391>",
      lookup
    );
    assert.equal(segmentsToText(segs), "ok done with it @Tournament Players join up on #sign-ups");
    const role = segs.find((s) => s.type === "role");
    assert.deepEqual(role, { type: "role", text: "@Tournament Players", color: "#ff5500" });
    const channel = segs.find((s) => s.type === "channel");
    assert.ok(channel && channel.type === "channel");
    assert.equal(
      channel.url,
      "discord://-/channels/973987866336190484/1280464713557344391",
      "opens the Discord app, like the party voice button"
    );
    assert.equal(
      channel.webUrl,
      "https://discord.com/channels/973987866336190484/1280464713557344391"
    );
  });

  it("a role with no colour gets the default pill", () => {
    const [seg] = parseMentions("<@&42>", lookup);
    assert.deepEqual(seg, { type: "role", text: "@Plain", color: null });
  });

  it("users, @everyone and custom emoji", () => {
    const text = segmentsToText(parseMentions("hi <@7> and <@!7> @everyone <:gg:123> <a:hype:456>", lookup));
    assert.equal(text, "hi @Skulls and @Skulls @everyone :gg: :hype:");
  });

  it("never leaks raw ids for unknown roles, channels or users", () => {
    const text = segmentsToText(parseMentions("<@&999> <#888> <@777>", lookup));
    assert.equal(text, "@unknown-role #unknown-channel @unknown-user");
    const channel = parseMentions("<#888>", lookup)[0];
    assert.ok(
      channel.type === "channel" && channel.url === null && channel.webUrl === null,
      "no link to a channel we can't name"
    );
  });

  it("renders Discord timestamps as dates", () => {
    const text = segmentsToText(parseMentions("starts <t:1790000000:D>", lookup));
    assert.match(text, /^starts \d{1,2} \w+ 2026$/);
  });

  it("leaves plain text alone and merges neighbouring text", () => {
    const segs = parseMentions("no mentions here :) <b>", lookup);
    assert.deepEqual(segs, [{ type: "text", text: "no mentions here :) <b>" }]);
  });
});
