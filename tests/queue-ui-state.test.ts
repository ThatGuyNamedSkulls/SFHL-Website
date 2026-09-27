/**
 * The Play page state machine (lib/queue-ui-state.ts, docs/QUEUE_UI_PLAN.md §3):
 * every state and every blocker, with its primary action.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { queueUiState, type QueueUiInputs } from "@/lib/queue-ui-state";

const ready: QueueUiInputs = {
  loading: false,
  signedIn: true,
  inGuild: true,
  verified: true,
  linked: true,
  region: "EU",
  regionLabel: "Europe",
  regionIsQueueRegion: true,
  openRegions: ["EU"],
  openModes: {},
  mode: "standard",
  modeLabel: "Standard Match",
  queued: null,
  inMatch: false,
  party: null,
  selfPlacing: false,
  proEligible: false,
  superPartyMax: 3,
  pending: null,
  regionLabels: { EU: "Europe", NA: "North America" },
};
const ui = (over: Partial<QueueUiInputs>) => queueUiState({ ...ready, ...over });

describe("queue UI state", () => {
  it("ready: find match is enabled", () => {
    const s = ui({});
    assert.equal(s.state, "ready");
    assert.equal(s.primary.action, "find");
    assert.equal(s.primary.disabled, false);
    assert.equal(s.lockSelection, false);
  });

  it("loading and guest", () => {
    assert.equal(ui({ loading: true }).state, "loading");
    const g = ui({ signedIn: false });
    assert.equal(g.state, "guest");
    assert.equal(g.primary.action, "login");
  });

  it("setup walks the steps in order", () => {
    const noGuild = ui({ inGuild: false, verified: false, linked: false });
    assert.equal(noGuild.state, "setup");
    assert.equal(noGuild.primary.action, "join_discord");
    assert.deepEqual(noGuild.steps!.map((s) => s.done), [false, false, false]);
    const noAccess = ui({ verified: false, linked: false });
    assert.equal(noAccess.primary.action, "verify");
    assert.deepEqual(noAccess.steps!.map((s) => s.done), [true, false, false]);
    const noProfile = ui({ linked: false });
    assert.equal(noProfile.primary.disabled, true);
    assert.deepEqual(noProfile.steps!.map((s) => s.done), [true, true, false]);
  });

  it("in a match beats everything after setup", () => {
    const s = ui({ inMatch: true, queued: { region: "EU", mode: "standard" } });
    assert.equal(s.state, "in_match");
    assert.equal(s.primary.action, "open_match");
    assert.equal(s.lockSelection, true);
  });

  it("match found: no cancel while the ready check runs", () => {
    const s = ui({ queued: { region: "EU", mode: "standard" }, matchFound: true });
    assert.equal(s.state, "match_found");
    assert.equal(s.primary.action, "none");
    assert.equal(s.primary.disabled, true);
    assert.equal(s.lockSelection, true);
    assert.equal(ui({ matchFound: true, inMatch: true }).state, "in_match");
  });

  it("searching: cancel, selection locked", () => {
    const s = ui({ queued: { region: "EU", mode: "standard" } });
    assert.equal(s.state, "searching");
    assert.equal(s.primary.action, "cancel");
    assert.equal(s.lockSelection, true);
    assert.match(s.headline, /Europe/);
    assert.equal(ui({ queued: { region: "EU", mode: "standard" }, pending: "leave" }).primary.disabled, true);
  });

  it("closed: no region open, with a way out", () => {
    const s = ui({ openRegions: [] });
    assert.equal(s.state, "closed");
    assert.equal(s.primary.disabled, true);
    assert.equal(s.secondary?.href, "/subs");
    assert.ok(!/\/queue|staff need/i.test(s.detail ?? ""), "no staff jargon");
  });

  it("blocked reasons, in player words", () => {
    assert.equal(ui({ regionIsQueueRegion: false, region: "GLOBAL" }).headline, "Pick a server");
    assert.match(ui({ region: "NA", regionLabel: "North America" }).headline, /North America is closed/);
    assert.match(ui({ openModes: { EU: ["standard"] }, mode: "super", modeLabel: "Super Match" }).headline, /Super Match is closed/);
    assert.match(
      ui({ party: { size: 3, isCaptain: false, blockedNames: [], placingNames: [] } }).headline,
      /captain/
    );
    assert.match(
      ui({ party: { size: 3, isCaptain: true, blockedNames: ["Kai"], placingNames: [] } }).headline,
      /Kai can't queue/
    );
    for (const s of [ui({ regionIsQueueRegion: false }), ui({ openModes: { EU: [] } })]) {
      assert.equal(s.state, "blocked");
      assert.equal(s.primary.disabled, true);
    }
  });

  it("super and pro rules", () => {
    const big = ui({ mode: "super", party: { size: 4, isCaptain: true, blockedNames: [], placingNames: [] } });
    assert.match(big.headline, /solo, duo or trio/);
    assert.match(ui({ mode: "super", selfPlacing: true }).detail ?? "", /placement/);
    assert.match(
      ui({ mode: "super", party: { size: 2, isCaptain: true, blockedNames: [], placingNames: ["Ana"] } }).detail ?? "",
      /Ana/
    );
    assert.equal(ui({ mode: "pro" }).state, "blocked");
    assert.equal(ui({ mode: "pro", proEligible: true, openModes: { EU: ["pro"] } }).state, "ready");
  });

  it("a join in flight disables the button and locks the selection", () => {
    const s = ui({ pending: "join" });
    assert.equal(s.primary.disabled, true);
    assert.equal(s.primary.label, "Joining…");
    assert.equal(s.lockSelection, true);
  });
});
