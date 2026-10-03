"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { STAT_ESTIMATE_HINT, ratingColor } from "@/lib/match-stats";
import type { WindowTotals } from "@/lib/profile-stats";
import type { TierBenchmark } from "@/lib/track";
import { benchmarkPosition, change } from "@/lib/track-stats";

const signed = (v: number, digits: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

interface MetricDef {
  key: string;
  label: string;
  value: (t: WindowTotals) => number | null;
  bench: (b: TierBenchmark) => number | null;
  /** Decimals shown; a change smaller than half the last one counts as none. */
  digits: number;
  format: (v: number) => string;
  /** Suffix for the change ("%" for percentages). */
  unit?: string;
  color?: (v: number) => string;
  /** Elo per match centres near zero: compare by ±this instead of a ratio. */
  absBand?: number;
  caption?: (t: WindowTotals) => string | null;
  hint?: string;
}

/** The nine Performance stats (docs/TRACK_UI_PLAN.md §4.6), higher is better for each. */
const METRICS: MetricDef[] = [
  { key: "win", label: "Win rate", value: (t) => t.winPercent, bench: (b) => b.winPercent, digits: 0, unit: "%", format: (v) => `${Math.round(v)}%` },
  {
    key: "rating",
    label: "Rating",
    value: (t) => t.rating,
    bench: (b) => b.rating,
    digits: 2,
    format: (v) => v.toFixed(2),
    color: ratingColor,
    hint: STAT_ESTIMATE_HINT,
  },
  { key: "kd", label: "K/D", value: (t) => t.kd, bench: (b) => b.kd, digits: 2, format: (v) => v.toFixed(2) },
  { key: "kr", label: "K/R", value: (t) => t.kr, bench: (b) => b.kr, digits: 2, format: (v) => v.toFixed(2) },
  { key: "adr", label: "ADR", value: (t) => t.adr, bench: (b) => b.adr, digits: 1, format: (v) => v.toFixed(1) },
  { key: "hs", label: "Headshot %", value: (t) => t.hsPercent, bench: (b) => b.hsPercent, digits: 0, unit: "%", format: (v) => `${Math.round(v)}%` },
  {
    key: "elo",
    label: "Elo per match",
    value: (t) => t.eloPerMatch,
    bench: (b) => b.eloPerMatch,
    digits: 1,
    format: (v) => signed(v, 1),
    absBand: 3,
  },
  { key: "mvp", label: "MVPs per match", value: (t) => t.mvpsPerMatch, bench: (b) => b.mvpsPerMatch, digits: 1, format: (v) => v.toFixed(1) },
  {
    key: "fk",
    label: "First kills per match",
    value: (t) => t.firstKillsPerMatch,
    bench: (b) => b.firstKillsPerMatch,
    digits: 2,
    format: (v) => v.toFixed(2),
    caption: (t) => (t.scoreboardMatches < t.matches ? `from ${t.scoreboardMatches} of ${t.matches} matches` : null),
    hint: "Only games ranked with Counter Blox's own scoreboard (/rank cbrm) record first kills.",
  },
];

const SEGMENT_COLORS = ["#e74c3c", "#f5b73b", "#2ecc71"] as const;

function Delta({ diff, def }: { diff: number; def: MetricDef }) {
  const flat = Math.abs(diff) < 0.5 * 10 ** -def.digits;
  const up = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[0.8125rem] font-bold tabular-nums ${
        flat ? "text-[#8a8a8a]" : up ? "text-[#2ecc71]" : "text-[#e74c3c]"
      }`}
      title="Change from the previous period"
    >
      {flat ? "=" : up ? <ArrowUp className="h-[0.8125rem] w-[0.8125rem]" strokeWidth={2.6} /> : <ArrowDown className="h-[0.8125rem] w-[0.8125rem]" strokeWidth={2.6} />}
      {flat ? "" : `${Math.abs(diff).toFixed(def.digits)}${def.unit ?? ""}`}
    </span>
  );
}

/**
 * The Performance grid: each stat for the range, its change from the period
 * before, and a bar placing it against the player's skill tier this season.
 */
export function PerformanceGrid({
  current,
  previous,
  benchmark,
  tierName,
}: {
  current: WindowTotals;
  previous: WindowTotals | null;
  benchmark: TierBenchmark | null;
  tierName: string;
}) {
  return (
    <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] px-4 pb-1.5 pt-1 md:px-[1.625rem] md:pb-2.5 md:pt-2">
      <div className="grid grid-cols-2 gap-x-[1.375rem] md:grid-cols-3 md:gap-x-11 [&>*:last-child]:border-b-0 md:[&>*:nth-last-child(-n+3)]:border-b-0">
        {METRICS.map((def) => {
          const v = def.value(current);
          const pv = previous ? def.value(previous) : null;
          const diff = change(v, pv);
          const avg = benchmark ? def.bench(benchmark) : null;
          const pos = v != null && avg != null ? benchmarkPosition(v, avg, def.absBand) : null;
          const caption = v != null && def.caption ? def.caption(current) : null;
          return (
            <div key={def.key} className="min-w-0 border-b border-white/[0.06] py-4 md:pb-[1.125rem] md:pt-5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <b
                  className="text-[1.3125rem] font-black tabular-nums md:text-2xl"
                  style={v != null && def.color ? { color: def.color(v) } : undefined}
                >
                  {v != null ? def.format(v) : "—"}
                </b>
                {diff != null ? <Delta diff={diff} def={def} /> : null}
              </div>
              <div className="mt-0.5 text-[0.8125rem] text-[#c8c8c8]" title={def.hint}>
                {def.label}
                {caption ? <span className="text-[0.6875rem] text-[#6a6a6a]"> · {caption}</span> : null}
              </div>
              {pos && avg != null ? (
                <div className="relative mt-3">
                  <div className="grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((i) => (
                      <i
                        key={i}
                        className="h-1 rounded-sm"
                        style={{ background: i === pos.segment ? SEGMENT_COLORS[i] : "#2e2e2e" }}
                      />
                    ))}
                  </div>
                  <span
                    aria-hidden
                    className="absolute -top-1 h-3 w-[3px] -translate-x-px rounded-sm bg-white shadow-[0_0_0_2px_#1c1c1c]"
                    style={{ left: `${(pos.x * 100).toFixed(1)}%` }}
                  />
                  <div className="mt-[0.4375rem] flex justify-between text-[0.6875rem] text-[#6a6a6a]">
                    <span>below</span>
                    <b className="font-semibold text-[#8a8a8a]">
                      {tierName} avg {def.format(avg)}
                    </b>
                    <span>above</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
