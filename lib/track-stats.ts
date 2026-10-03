/**
 * Pure helpers for the Track page (docs/TRACK_UI_PLAN.md): where a stat sits
 * against the tier average, play sessions by day, the per-map breakdown and
 * the Form chart's series. Unit-tested in tests/track-stats.test.ts.
 */
import { adrOf, localDayKey, matchRating, parseDbTime, roundsOf, windowTotals, type WindowTotals } from "@/lib/profile-stats";
import type { Match } from "@/types";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Where a value sits on the three-part benchmark bar (below · typical ·
 * above). Ratios: "typical" is within ±10 % of the tier average and the bar
 * spans 70 %–130 % of it. With `absBand` (Elo per match, which centres near
 * zero) "typical" is within ±absBand of the average and the bar spans ±3×.
 * `x` is 0–1 across the bar.
 */
export function benchmarkPosition(
  value: number,
  average: number,
  absBand?: number
): { x: number; segment: 0 | 1 | 2 } {
  if (absBand != null && absBand > 0) {
    const diff = value - average;
    return {
      x: clamp01((diff + 3 * absBand) / (6 * absBand)),
      segment: diff < -absBand ? 0 : diff > absBand ? 2 : 1,
    };
  }
  if (!(average > 0)) return { x: 0.5, segment: 1 };
  const ratio = value / average;
  return {
    x: clamp01((ratio - 0.7) / 0.6),
    segment: ratio < 0.9 ? 0 : ratio > 1.1 ? 2 : 1,
  };
}

export interface DaySession {
  /** Local calendar day ("2026-10-02"). */
  key: string;
  /** First and last match time (epoch ms). */
  startMs: number;
  endMs: number;
  /** Newest first. */
  matches: Match[];
  totals: WindowTotals;
}

/** Matches grouped by local calendar day (Q5), newest day first. Undated rows are left out. */
export function sessionsByDay(matches: Match[]): DaySession[] {
  const byDay = new Map<string, { ms: number; match: Match }[]>();
  for (const m of matches) {
    const ms = parseDbTime(m.date);
    if (ms == null) continue;
    const key = localDayKey(ms);
    const list = byDay.get(key) ?? [];
    list.push({ ms, match: m });
    byDay.set(key, list);
  }
  return [...byDay.entries()]
    .map(([key, list]) => {
      list.sort((a, b) => b.ms - a.ms || (b.match.rowId ?? 0) - (a.match.rowId ?? 0));
      const ordered = list.map((x) => x.match);
      return {
        key,
        startMs: list[list.length - 1].ms,
        endMs: list[0].ms,
        matches: ordered,
        totals: windowTotals(ordered),
      };
    })
    .sort((a, b) => b.endMs - a.endMs);
}

export interface MapSummary {
  map: string;
  totals: WindowTotals;
  /** Best / worst win rate among maps with MAP_TAG_MIN matches. */
  tag: "best" | "work" | null;
}

/** Maps need this many matches in the range for a "Best map" / "Needs work" tag. */
export const MAP_TAG_MIN = 3;

/** One summary per map, most played first. */
export function mapBreakdown(matches: Match[]): MapSummary[] {
  const byMap = new Map<string, Match[]>();
  for (const m of matches) {
    const map = m.map || "Unknown";
    byMap.set(map, [...(byMap.get(map) ?? []), m]);
  }
  const rows: MapSummary[] = [...byMap.entries()]
    .map(([map, list]) => ({ map, totals: windowTotals(list), tag: null as MapSummary["tag"] }))
    .sort((a, b) => b.totals.matches - a.totals.matches || a.map.localeCompare(b.map));
  const eligible = rows.filter((r) => r.totals.matches >= MAP_TAG_MIN);
  if (eligible.length >= 2) {
    const better = (a: MapSummary, b: MapSummary) =>
      a.totals.winPercent - b.totals.winPercent || a.totals.rating - b.totals.rating;
    const best = eligible.reduce((b, r) => (better(r, b) > 0 ? r : b));
    const worst = eligible.reduce((w, r) => (better(r, w) < 0 ? r : w));
    if (best !== worst && better(best, worst) > 0) {
      best.tag = "best";
      worst.tag = "work";
    }
  }
  return rows;
}

export type FormMetric = "rating" | "kd" | "adr" | "elo";

/** One match's value for the Form chart, or null when it isn't known (ADR without damage). */
export function formValue(m: Match, metric: FormMetric): number | null {
  switch (metric) {
    case "rating":
      return matchRating(m);
    case "kd":
      return m.kdr;
    case "adr":
      return adrOf(m.damage, roundsOf(m));
    case "elo":
      return m.eloChange || 0;
  }
}

/** The average of each value and the (up to) `window - 1` before it. */
export function rollingAverage(values: number[], window = 5): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

export interface FormSeries {
  /** Oldest → newest, matches with a known value only. */
  points: { match: Match; value: number }[];
  rolling: number[];
  average: number;
  /** Average of the newest five. */
  last5: number;
  best: { match: Match; value: number } | null;
  worst: { match: Match; value: number } | null;
}

/** The Form chart for a range (matches in any order). */
export function formSeries(matches: Match[], metric: FormMetric): FormSeries {
  const chrono = [...matches].sort(
    (a, b) => (parseDbTime(a.date) ?? 0) - (parseDbTime(b.date) ?? 0) || (a.rowId ?? 0) - (b.rowId ?? 0)
  );
  const points = chrono
    .map((match) => ({ match, value: formValue(match, metric) }))
    .filter((p): p is { match: Match; value: number } => p.value != null);
  const values = points.map((p) => p.value);
  const mean = (list: number[]) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
  return {
    points,
    rolling: rollingAverage(values),
    average: mean(values),
    last5: mean(values.slice(-5)),
    best: points.length ? points.reduce((b, p) => (p.value > b.value ? p : b)) : null,
    worst: points.length ? points.reduce((w, p) => (p.value < w.value ? p : w)) : null,
  };
}

/** The change from the previous period, or null when either side is unknown. */
export function change(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}
