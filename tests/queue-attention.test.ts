/**
 * Queue attention helpers (lib/queue-attention.ts): timer text, tab titles and
 * which sound each queue transition makes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { baseTitle, formatElapsed, queueJustOpened, soundForTransition, titleFor } from "@/lib/queue-attention";

describe("formatElapsed", () => {
  it("formats minutes and hours", () => {
    assert.equal(formatElapsed(7_000), "0:07");
    assert.equal(formatElapsed(84_000), "1:24");
    assert.equal(formatElapsed(725_000), "12:05");
    assert.equal(formatElapsed(3_729_000), "1:02:09");
    assert.equal(formatElapsed(-5), "0:00");
  });
});

describe("tab titles", () => {
  const t = "HyperLeague — Counter Blox Matchmaking";
  it("adds and strips the prefix", () => {
    const s = titleFor({ kind: "searching", since: 0 }, t, 84_000);
    assert.equal(s, `▶ 1:24 · ${t}`);
    assert.equal(baseTitle(s), t);
    // Re-applying never stacks prefixes.
    assert.equal(titleFor({ kind: "searching", since: 0 }, s, 90_000), `▶ 1:30 · ${t}`);
  });
  it("flashes on match found and restores when idle", () => {
    assert.equal(titleFor({ kind: "found", flash: true }, t, 0), `⚠ MATCH FOUND — ${t}`);
    assert.equal(titleFor({ kind: "found", flash: false }, `⚠ MATCH FOUND — ${t}`, 0), t);
    assert.equal(titleFor({ kind: "idle" }, `▶ 0:10 · ${t}`, 0), t);
  });
});

describe("transition sounds", () => {
  const idle = { queued: false, checkId: null, checkStatus: null };
  const queued = { queued: true, checkId: null, checkStatus: null };
  it("never plays on the first answer", () => {
    assert.equal(soundForTransition(null, queued), null);
  });
  it("start, end, found", () => {
    assert.equal(soundForTransition(idle, queued), "start");
    assert.equal(soundForTransition(queued, idle), "end");
    assert.equal(soundForTransition(queued, { queued: true, checkId: "c1", checkStatus: "pending" }), "found");
    // The web queue row goes away when the check starts: that's not "queue ended".
    assert.equal(soundForTransition(queued, { queued: false, checkId: "c1", checkStatus: "pending" }), "found");
    assert.equal(
      soundForTransition({ queued: false, checkId: "c1", checkStatus: "pending" }, { queued: false, checkId: "c1", checkStatus: "started" }),
      null
    );
    // Same check, still pending: no repeat.
    assert.equal(
      soundForTransition({ queued: true, checkId: "c1", checkStatus: "pending" }, { queued: true, checkId: "c1", checkStatus: "pending" }),
      null
    );
    assert.equal(soundForTransition(queued, queued), null);
  });
});

describe("queue opened on my server", () => {
  it("chimes only when my server goes from closed to open", () => {
    assert.equal(queueJustOpened([], ["EU"], "EU"), true);
    assert.equal(queueJustOpened(["NA"], ["NA", "EU"], "EU"), true);
    assert.equal(queueJustOpened(["EU"], ["EU"], "EU"), false, "already open");
    assert.equal(queueJustOpened([], ["NA"], "EU"), false, "another server");
    assert.equal(queueJustOpened(["EU"], [], "EU"), false, "closing is silent");
  });
  it("never on the first answer or without a picked server", () => {
    assert.equal(queueJustOpened(null, ["EU"], "EU"), false);
    assert.equal(queueJustOpened([], ["EU"], null), false);
  });
});
