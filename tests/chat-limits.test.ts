/**
 * Right-bar rules: every chat shows only its last 10 messages, and the
 * online-friends badge never shows more than 9.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHAT_FETCH,
  ONLINE_BADGE_CAP,
  RAIL_CHAT_MESSAGES,
  lastMessages,
  onlineBadgeCount,
  parseChatLimit,
} from "@/lib/chat-limits";

const msgs = (ids: number[]) => ids.map((id) => ({ id, text: `m${id}` }));

describe("last 10 messages per chat", () => {
  it("shows 10", () => assert.equal(RAIL_CHAT_MESSAGES, 10));

  it("keeps only the newest 10, oldest first", () => {
    const got = lastMessages(msgs(Array.from({ length: 25 }, (_, i) => i + 1)));
    assert.deepEqual(got.map((m) => m.id), [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  });

  it("orders out-of-order batches and drops duplicates", () => {
    const got = lastMessages([...msgs([5, 3, 9]), ...msgs([9, 1, 3])]);
    assert.deepEqual(got.map((m) => m.id), [1, 3, 5, 9]);
  });

  it("a newer copy of a message replaces the older one", () => {
    const got = lastMessages([{ id: 1, text: "old" }, { id: 1, text: "new" }]);
    assert.deepEqual(got, [{ id: 1, text: "new" }]);
  });
});

describe("?limit= parsing for the chat APIs", () => {
  it("uses the fallback for missing or bad values", () => {
    for (const raw of [null, "", "abc", "0", "-3"]) assert.equal(parseChatLimit(raw, 10), 10);
  });
  it("clamps to 1..MAX_CHAT_FETCH", () => {
    assert.equal(parseChatLimit("5", 10), 5);
    assert.equal(parseChatLimit("7.9", 10), 7);
    assert.equal(parseChatLimit("100000", 10), MAX_CHAT_FETCH);
  });
});

describe("online friends badge", () => {
  it("counts up to 9 and stops there", () => {
    assert.equal(ONLINE_BADGE_CAP, 9);
    assert.equal(onlineBadgeCount(0), 0);
    assert.equal(onlineBadgeCount(1), 1);
    assert.equal(onlineBadgeCount(9), 9);
    assert.equal(onlineBadgeCount(10), 9);
    assert.equal(onlineBadgeCount(250), 9);
  });
});
