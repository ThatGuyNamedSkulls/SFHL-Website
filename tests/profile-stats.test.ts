/**
 * The profile's pure helpers (docs/PROFILE_UI_PLAN.md): database times read as
 * UTC, "Member since", streaks, window totals (K/R and ADR only over matches
 * that have the numbers), tier progress, filters, links and the background tint.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adrOf,
  currentStreak,
  formatMatchWhen,
  formatMemberSince,
  localDayKey,
  longestWinStreak,
  parseDbTime,
  relativeTime,
  roundsOf,
  tierProgress,
  windowTotals,
} from "@/lib/profile-stats";
import { DEFAULT_FILTERS, applyMatchFilters } from "@/lib/match-filters";
import { buildEloTimeline } from "@/lib/elo-timeline";
import { isProfileTab, nameFromSegment, profileHref } from "@/lib/profile-link";
import { luminance, profileBandImage } from "@/lib/profile-backgrounds";
import type { Match } from "@/types";

function match(over: Partial<Match> = {}): Match {
  return {
    id: "M-1",
    date: "2026-10-01 18:00:00",
    region: "EU",
    map: "Mirage",
    mode: "Competitive",
    result: "W",
    kills: 20,
    deaths: 10,
    assists: 4,
    kdr: 2,
    headshotPercent: 50,
    eloChange: 20,
    score: 50,
    rounds: "13:9",
    mvp: true,
    mvps: 3,
    ...over,
  };
}

describe("parseDbTime", () => {
  it("reads the bot's zone-less timestamps as UTC (they showed an hour off in Portugal)", () => {
    assert.equal(parseDbTime("2026-09-30 20:59:36"), Date.UTC(2026, 8, 30, 20, 59, 36));
    assert.equal(parseDbTime("2026-09-30T20:59:36"), Date.UTC(2026, 8, 30, 20, 59, 36));
  });

  it("keeps an explicit zone, and handles date-only values", () => {
    assert.equal(parseDbTime("2026-09-30T20:59:36Z"), Date.UTC(2026, 8, 30, 20, 59, 36));
    assert.equal(parseDbTime("2026-09-30T21:59:36+01:00"), Date.UTC(2026, 8, 30, 20, 59, 36));
    assert.equal(parseDbTime("2026-09-30"), Date.UTC(2026, 8, 30));
  });

  it("is null for nothing or garbage", () => {
    assert.equal(parseDbTime(null), null);
    assert.equal(parseDbTime(""), null);
    assert.equal(parseDbTime("yesterday"), null);
  });
});

describe("formatMemberSince", () => {
  it("formats a database timestamp instead of printing it raw", () => {
    assert.equal(formatMemberSince("2026-09-30 12:00:00"), "Member since Sep 30, 2026");
  });

  it("is null when there is no usable date", () => {
    assert.equal(formatMemberSince(null), null);
    assert.equal(formatMemberSince("not a date"), null);
  });
});

describe("formatMatchWhen", () => {
  it("shows the UTC instant in the viewer's own zone", () => {
    const utc = Date.UTC(2026, 8, 30, 20, 59, 36);
    const { day, time } = formatMatchWhen("2026-09-30 20:59:36");
    assert.equal(time, new Date(utc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }));
    assert.equal(day, new Date(utc).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
  });

  it("passes an unparseable value through", () => {
    assert.deepEqual(formatMatchWhen("soon"), { day: "soon", time: "" });
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 2, 18, 0, 0);
  it("words the gap", () => {
    assert.equal(relativeTime(now - 20_000, now), "just now");
    assert.equal(relativeTime(now - 5 * 60_000, now), "5 minutes ago");
    assert.equal(relativeTime(now - 60 * 60_000, now), "1 hour ago");
    assert.equal(relativeTime(now - 110 * 60_000, now), "2 hours ago");
    assert.equal(relativeTime(now - 3 * 864e5, now), "3 days ago");
    assert.equal(relativeTime(now - 90 * 864e5, now), "3 months ago");
  });
});

describe("streaks", () => {
  it("current streak is the run at the newest end", () => {
    assert.deepEqual(currentStreak([{ result: "W" }, { result: "W" }, { result: "L" }]), { result: "W", count: 2 });
    assert.deepEqual(currentStreak([{ result: "L" }]), { result: "L", count: 1 });
    assert.equal(currentStreak([]), null);
  });

  it("longest win streak", () => {
    const seq = "WWLWWWLW".split("").map((result) => ({ result }));
    assert.equal(longestWinStreak(seq), 3);
    assert.equal(longestWinStreak([{ result: "L" }]), 0);
  });
});

describe("rounds and ADR", () => {
  it("rounds come from Counter Blox's count first, then the scoreline", () => {
    assert.equal(roundsOf({ rounds: "13:9", roundsPlayed: null }), 22);
    assert.equal(roundsOf({ rounds: "13:9", roundsPlayed: 24 }), 24);
    assert.equal(roundsOf({ rounds: "", roundsPlayed: null }), null);
  });

  it("ADR has one decimal and needs both numbers", () => {
    assert.equal(adrOf(2163, 22), 98.3);
    assert.equal(adrOf(null, 22), null);
    assert.equal(adrOf(2163, 0), null);
  });
});

describe("windowTotals", () => {
  const list = [
    match({ date: "2026-10-01 20:00:00", result: "W", kills: 20, deaths: 10, kdr: 2, damage: 2200, rounds: "13:9", eloChange: 20 }),
    match({ date: "2026-10-01 19:00:00", result: "L", kills: 10, deaths: 20, kdr: 0.5, damage: null, rounds: "9:13", eloChange: -18 }),
    // No scoreline: counts for K/D but not for K/R or ADR.
    match({ date: "2026-10-01 18:00:00", result: "W", kills: 30, deaths: 10, kdr: 3, damage: 3000, rounds: "", eloChange: 22 }),
  ];
  const t = windowTotals(list);

  it("record, K/D and Elo", () => {
    assert.equal(t.matches, 3);
    assert.equal(t.wins, 2);
    assert.equal(t.losses, 1);
    assert.equal(Math.round(t.winPercent), 67);
    assert.equal(t.kd, 1.5); // 60 / 40
    assert.equal(t.eloChange, 24);
  });

  it("K/R only over matches with a round count; ADR only with damage too", () => {
    assert.equal(t.kr, 30 / 44);
    assert.equal(t.adr, 2200 / 22);
  });

  it("sparkline series run oldest → newest", () => {
    assert.equal(t.ratings.length, 3);
    assert.ok(t.ratings[0] > t.ratings[1]); // the 30-kill game is the oldest
    assert.ok(t.consistency >= 0 && t.consistency <= 100);
  });

  it("an empty window is all zeros, not NaN", () => {
    const e = windowTotals([]);
    assert.equal(e.matches, 0);
    assert.equal(e.winPercent, 0);
    assert.equal(e.kr, null);
    assert.equal(e.adr, null);
    assert.equal(e.consistency, 0);
  });
});

describe("tierProgress", () => {
  it("A3 at 1599 is 74.5% through, 51 Elo from S1", () => {
    const p = tierProgress("A3", 1599);
    assert.equal(p.percent, 74.5);
    assert.equal(p.toNext, 51);
    assert.equal(p.next?.letter, "S1");
  });

  it("S3 points at ★, which is the top", () => {
    assert.equal(tierProgress("S3", 2400).next?.letter, "STAR");
    assert.equal(tierProgress("S3", 2400).toNext, 100);
    assert.equal(tierProgress("STAR", 2600).next, null);
  });

  it("unranked has no progress", () => {
    const p = tierProgress("UNRANKED", 0);
    assert.equal(p.next, null);
    assert.equal(p.percent, 0);
  });
});

describe("applyMatchFilters", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const list = [
    match({ id: "a", map: "Mirage", result: "W", gameMode: "5v5", date: "2026-10-01 12:00:00" }),
    match({ id: "b", map: "Inferno", result: "L", gameMode: "2v2", date: "2026-09-20 12:00:00" }),
    match({ id: "c", map: "Mirage", result: "L", gameMode: null, date: "2026-06-01 12:00:00" }),
  ];
  const ids = (xs: Match[]) => xs.map((m) => m.id).join("");

  it("by map, result, mode and time", () => {
    assert.equal(ids(applyMatchFilters(list, DEFAULT_FILTERS, now)), "abc");
    assert.equal(ids(applyMatchFilters(list, { ...DEFAULT_FILTERS, map: "Mirage" }, now)), "ac");
    assert.equal(ids(applyMatchFilters(list, { ...DEFAULT_FILTERS, result: "L" }, now)), "bc");
    assert.equal(ids(applyMatchFilters(list, { ...DEFAULT_FILTERS, mode: "2v2" }, now)), "b");
    assert.equal(ids(applyMatchFilters(list, { ...DEFAULT_FILTERS, range: "7d" }, now)), "a");
    assert.equal(ids(applyMatchFilters(list, { ...DEFAULT_FILTERS, range: "30d" }, now)), "ab");
  });
});

describe("buildEloTimeline times", () => {
  it("lines each point up with the match that produced it", () => {
    const changes = [
      { eloChange: 20, timestamp: "2026-09-12 10:00:00" },
      { eloChange: -10, timestamp: "2026-09-11 10:00:00" },
    ];
    const t = buildEloTimeline(1510, changes, [], new Map());
    assert.deepEqual(t.history, [1500, 1490, 1510]);
    assert.deepEqual(t.times, [null, "2026-09-11 10:00:00", "2026-09-12 10:00:00"]);
  });

  it("keeps times aligned across a season reset", () => {
    const changes = [
      { eloChange: 25, timestamp: "2026-09-20 10:00:00" }, // this season
      { eloChange: 15, timestamp: "2026-08-20 10:00:00" }, // last season
    ];
    const t = buildEloTimeline(
      1225,
      changes,
      [{ season_name: "Season 1", reset_at: "2026-09-01 00:00:00" }],
      new Map([["Season 1", 1400]])
    );
    assert.equal(t.history.length, t.times.length);
    assert.deepEqual(t.history, [1385, 1400, null, 1200, 1225]);
    assert.deepEqual(t.times, [null, "2026-08-20 10:00:00", null, null, "2026-09-20 10:00:00"]);
  });
});

describe("profile links", () => {
  it("/profile/<name>, tabs as ?tab=", () => {
    assert.equal(profileHref("frostbyte"), "/profile/frostbyte");
    assert.equal(profileHref("frost byte", "stats"), "/profile/frost%20byte?tab=stats");
    assert.equal(profileHref("frostbyte", "summary"), "/profile/frostbyte");
    assert.equal(profileHref("a/b"), "/profile/a%2Fb");
  });

  it("reads a segment whether or not it arrives decoded", () => {
    assert.equal(nameFromSegment("frost%20byte"), "frost byte");
    assert.equal(nameFromSegment("frost byte"), "frost byte");
    assert.equal(nameFromSegment("100%"), "100%");
  });

  it("knows its tabs", () => {
    assert.ok(isProfileTab("stats"));
    assert.ok(!isProfileTab("hacks"));
    assert.ok(!isProfileTab(null));
  });
});

describe("profileBandImage", () => {
  it("tints lighter colors less so text stays readable", () => {
    assert.ok(luminance("#f5f5f5") > 0.6);
    assert.ok(luminance("#7c3aed") < 0.35);
    assert.match(profileBandImage("#f5f5f5")!, /#f5f5f5 14%/);
    assert.match(profileBandImage("#f1c40f")!, /#f1c40f 22%/);
    assert.match(profileBandImage("#7c3aed")!, /#7c3aed 34%/);
  });

  it("ignores anything that isn't a hex color", () => {
    assert.equal(profileBandImage(null), undefined);
    assert.equal(profileBandImage("url(x)"), undefined);
  });
});

describe("localDayKey", () => {
  it("is the viewer's calendar day", () => {
    const d = new Date(2026, 9, 2, 23, 30);
    assert.equal(localDayKey(d.getTime()), "2026-10-02");
  });
});
