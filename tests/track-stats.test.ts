/**
 * The Track page's pure helpers (docs/TRACK_UI_PLAN.md): the benchmark bar,
 * sessions by local day (Q5), the map breakdown, the Form series and links.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkPosition,
  change,
  formSeries,
  formValue,
  mapBreakdown,
  rollingAverage,
  sessionsByDay,
} from "@/lib/track-stats";
import { dayLabel, localDayKey } from "@/lib/profile-stats";
import { isTrackRange, isTrackTab, trackHref } from "@/lib/track-link";
import type { Match } from "@/types";

let seq = 0;
function match(over: Partial<Match> = {}): Match {
  seq++;
  return {
    id: `M-${seq}`,
    rowId: seq,
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

/** A database (UTC) timestamp for a LOCAL time, so day grouping works in any zone. */
function localTs(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString().slice(0, 19).replace("T", " ");
}

describe("benchmarkPosition", () => {
  it("ratios: typical within ±10% of the tier average, the bar spans 70%–130%", () => {
    const even = benchmarkPosition(1.15, 1.15);
    assert.equal(even.segment, 1);
    assert.ok(Math.abs(even.x - 0.5) < 1e-9);
    assert.equal(benchmarkPosition(1.0, 1.15).segment, 0); // 87%
    assert.equal(benchmarkPosition(1.3, 1.15).segment, 2); // 113%
    assert.equal(benchmarkPosition(5, 1).x, 1);
    assert.equal(benchmarkPosition(0, 1).x, 0);
  });

  it("Elo per match: typical within ±band of the average", () => {
    assert.deepEqual(benchmarkPosition(0, 0, 3), { x: 0.5, segment: 1 });
    assert.equal(benchmarkPosition(-4, 0, 3).segment, 0);
    assert.equal(benchmarkPosition(4, 0, 3).segment, 2);
    assert.equal(benchmarkPosition(12, 0, 3).x, 1);
    assert.equal(benchmarkPosition(1, 2, 3).segment, 1); // against a non-zero average
  });

  it("a zero average has no bar position to speak of", () => {
    assert.deepEqual(benchmarkPosition(3, 0), { x: 0.5, segment: 1 });
  });
});

describe("sessionsByDay", () => {
  const list = [
    match({ date: localTs(2026, 10, 2, 21, 30), result: "W", eloChange: 20 }),
    match({ date: localTs(2026, 10, 2, 20, 0), result: "L", eloChange: -18 }),
    match({ date: localTs(2026, 10, 1, 23, 50), result: "W", eloChange: 22 }),
    match({ date: localTs(2026, 10, 2, 0, 10), result: "W", eloChange: 19 }), // after midnight: the next day
    match({ date: "", result: "W" }), // undated: left out
  ];
  const sessions = sessionsByDay(list);

  it("one session per local calendar day, newest first", () => {
    assert.deepEqual(
      sessions.map((s) => [s.key, s.matches.length]),
      [
        [localDayKey(new Date(2026, 9, 2).getTime()), 3],
        [localDayKey(new Date(2026, 9, 1).getTime()), 1],
      ]
    );
  });

  it("each day's span, record and Elo", () => {
    const today = sessions[0];
    assert.equal(today.startMs, new Date(2026, 9, 2, 0, 10).getTime());
    assert.equal(today.endMs, new Date(2026, 9, 2, 21, 30).getTime());
    assert.equal(today.totals.wins, 2);
    assert.equal(today.totals.losses, 1);
    assert.equal(today.totals.eloChange, 21);
    assert.equal(today.matches[0].date, localTs(2026, 10, 2, 21, 30)); // newest first
  });

  it("dayLabel says Today / Yesterday, then the date", () => {
    const now = new Date(2026, 9, 2, 22, 0).getTime();
    assert.equal(dayLabel(sessions[0].endMs, now), "Today");
    assert.equal(dayLabel(sessions[1].endMs, now), "Yesterday");
    assert.match(dayLabel(new Date(2026, 8, 28, 12).getTime(), now), /28 Sept?/);
  });
});

describe("mapBreakdown", () => {
  const ms = (map: string, results: string) =>
    [...results].map((r) => match({ map, result: r as "W" | "L", eloChange: r === "W" ? 20 : -20 }));

  it("most played first, Best map / Needs work among maps with 3+ matches", () => {
    const rows = mapBreakdown([...ms("Mirage", "WWWL"), ...ms("Inferno", "WLL"), ...ms("Nuke", "LL"), ...ms("Dust II", "WWW")]);
    assert.deepEqual(
      rows.map((r) => [r.map, r.totals.matches, r.tag]),
      [
        ["Mirage", 4, null],
        ["Dust II", 3, "best"],
        ["Inferno", 3, "work"],
        ["Nuke", 2, null], // 0% but only two matches
      ]
    );
  });

  it("no tags with a single eligible map, or when they all tie", () => {
    assert.ok(mapBreakdown(ms("Mirage", "WWL")).every((r) => r.tag === null));
    const tie = mapBreakdown([...ms("Mirage", "WWL"), ...ms("Inferno", "WWL")]);
    assert.ok(tie.every((r) => r.tag === null));
  });
});

describe("Form", () => {
  it("rolling average over the last five values", () => {
    assert.deepEqual(rollingAverage([1, 2, 3, 4, 5, 6]), [1, 1.5, 2, 2.5, 3, 4]);
    assert.deepEqual(rollingAverage([]), []);
  });

  it("per-match values; ADR is unknown without damage", () => {
    const m = match({ damage: 1760, roundsPlayed: 22, eloChange: -18 });
    assert.equal(formValue(m, "kd"), 2);
    assert.equal(formValue(m, "adr"), 80);
    assert.equal(formValue(m, "elo"), -18);
    assert.equal(formValue(match({ damage: null }), "adr"), null);
    assert.ok((formValue(m, "rating") ?? 0) > 1);
  });

  it("series oldest → newest with best, worst and the last five", () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((k, i) =>
      match({ date: `2026-10-0${i + 1} 18:00:00`, kdr: k, kills: k, deaths: 1 })
    );
    const s = formSeries([...list].reverse(), "kd");
    assert.deepEqual(s.points.map((p) => p.value), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(s.average, 4);
    assert.equal(s.last5, 5);
    assert.equal(s.best?.value, 7);
    assert.equal(s.worst?.value, 1);
  });

  it("change() needs both periods", () => {
    assert.equal(change(1.2, 1), 1.2 - 1);
    assert.equal(change(1.2, null), null);
    assert.equal(change(null, 1), null);
  });
});

describe("track links", () => {
  it("/track/<name>, defaults left out of the query", () => {
    assert.equal(trackHref("frostbyte"), "/track/frostbyte");
    assert.equal(trackHref("frostbyte", { tab: "stats", range: "last20" }), "/track/frostbyte");
    assert.equal(trackHref("big boss", { tab: "maps", range: "30d" }), "/track/big%20boss?tab=maps&range=30d");
    assert.equal(trackHref("a", { map: "Mirage|de_mirage" }), "/track/a?map=Mirage%7Cde_mirage");
  });

  it("only known tabs and ranges", () => {
    assert.ok(isTrackTab("maps"));
    assert.ok(!isTrackTab("summary"));
    assert.ok(isTrackRange("season"));
    assert.ok(!isTrackRange("90d"));
  });
});
