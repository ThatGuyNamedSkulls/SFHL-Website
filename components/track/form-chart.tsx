"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatScoreDisplay } from "@/lib/format";
import { formatMatchWhen } from "@/lib/profile-stats";
import type { TierBenchmark } from "@/lib/track";
import { formSeries, type FormMetric } from "@/lib/track-stats";
import type { Match } from "@/types";

/** Bars shown at most; a longer range shows its newest matches. */
const MAX_BARS = 50;
const HEIGHT = 220;
const PAD = { left: 40, right: 8, top: 12, bottom: 22 };

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v))}`;

const METRICS: Record<FormMetric, { label: string; format: (v: number) => string; bench: (b: TierBenchmark) => number | null }> = {
  rating: { label: "Rating", format: (v) => v.toFixed(2), bench: (b) => b.rating },
  kd: { label: "K/D", format: (v) => v.toFixed(2), bench: (b) => b.kd },
  adr: { label: "ADR", format: (v) => v.toFixed(1), bench: (b) => b.adr },
  elo: { label: "Elo ±", format: signed, bench: (b) => b.eloPerMatch },
};

function SideBox({ title, value, aside, sub }: { title: string; value: React.ReactNode; aside: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-[0.625rem] border border-white/[0.06] bg-[#161616] px-3 py-[0.6875rem]">
      <div className="header-caps text-[0.6875rem] tracking-[0.12em] text-[#8a8a8a]">{title}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <b className="text-xl font-black tabular-nums">{value}</b>
        {aside}
      </div>
      <div className="mt-0.5 truncate text-xs text-[#8a8a8a]">{sub}</div>
    </div>
  );
}

/**
 * Form (§4.7): a bar per match for the chosen stat, green or red by result,
 * a 5-match rolling average and the tier's average as a dashed line; the
 * newest five against the range, and the best and worst match.
 */
export function FormChart({
  matches,
  benchmark,
  tierName,
}: {
  matches: Match[];
  benchmark: TierBenchmark | null;
  tierName: string;
}) {
  const [metric, setMetric] = useState<FormMetric>("rating");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const def = METRICS[metric];
  const series = useMemo(() => {
    const all = formSeries(matches, metric);
    if (all.points.length <= MAX_BARS) return all;
    // Same summary over the shown bars, so the side boxes match the chart.
    const shown = all.points.slice(-MAX_BARS).map((p) => p.match);
    return formSeries(shown, metric);
  }, [matches, metric]);
  const bench = benchmark ? def.bench(benchmark) : null;

  const geo = useMemo(() => {
    const pts = series.points;
    if (pts.length < 2 || width < 120) return null;
    const values = pts.map((p) => p.value);
    const lo = Math.min(0, ...values, bench ?? 0);
    const hi = Math.max(...values, bench ?? 0, lo + 0.01);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;
    const step = (width - PAD.left - PAD.right) / pts.length;
    return { lo, hi, y, step, barW: Math.max(3, Math.min(22, step * 0.62)) };
  }, [series, width, bench]);

  const hovered = hover != null ? series.points[hover] : null;
  const better = series.last5 >= series.average;
  const total = matches.length;

  return (
    <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-3.5 md:px-5 md:py-[1.125rem]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-base font-extrabold text-white">
            Form
            {series.points.length >= MAX_BARS && total > MAX_BARS ? (
              <span className="ml-2 text-xs font-medium text-[#8a8a8a]">newest {MAX_BARS} matches</span>
            ) : null}
          </h2>
          {series.points.length >= 2 ? (
            <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[#8a8a8a]">
              <span className="inline-flex items-center gap-1.5">
                <i className="h-0.5 w-4 rounded-full bg-[#ff5500]" /> 5-match average
              </span>
              {bench != null ? (
                <span className="inline-flex items-center gap-1.5">
                  <i className="w-4 border-t-[1.5px] border-dashed border-[#9B59B6]" /> {tierName} average{" "}
                  <b className="font-semibold tabular-nums text-[#c39be0]">{def.format(bench)}</b>
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Form stat">
          {(Object.keys(METRICS) as FormMetric[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={metric === k}
              onClick={() => setMetric(k)}
              className={`h-7 rounded-full border px-3 text-xs font-extrabold ${
                metric === k
                  ? "border-[#ff5500]/50 bg-[#ff5500]/15 text-[#ff5500]"
                  : "border-white/[0.08] text-[#8a8a8a] hover:text-white"
              }`}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14.375rem]">
        <div ref={wrapRef} className="relative min-w-0" style={{ height: HEIGHT }}>
          {series.points.length < 2 ? (
            <p className="flex h-full items-center justify-center text-sm text-[#8a8a8a]">
              {metric === "adr" && total >= 2 ? "No damage recorded for these matches." : "Not enough matches."}
            </p>
          ) : geo ? (
            <svg width={width} height={HEIGHT} className="block select-none" onMouseLeave={() => setHover(null)}>
              {[geo.lo, (geo.lo + geo.hi) / 2, geo.hi].map((t, i) => (
                <g key={i}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} stroke="rgba(255,255,255,0.05)" />
                  <text x={4} y={geo.y(t) + 4} fill="#6a6a6a" fontSize={10}>
                    {def.format(t)}
                  </text>
                </g>
              ))}
              {series.points.map((p, i) => {
                const base = geo.y(Math.max(0, geo.lo));
                const top = Math.min(geo.y(p.value), base);
                const h = Math.max(2, Math.abs(geo.y(p.value) - base));
                const x = PAD.left + i * geo.step + (geo.step - geo.barW) / 2;
                const win = p.match.result === "W";
                return (
                  <g key={p.match.id} onMouseEnter={() => setHover(i)}>
                    <rect x={PAD.left + i * geo.step} y={PAD.top} width={geo.step} height={HEIGHT - PAD.top - PAD.bottom} fill="transparent" />
                    <rect
                      x={x}
                      y={top}
                      width={geo.barW}
                      height={h}
                      rx={2}
                      fill={win ? "rgba(46,204,113,0.75)" : "rgba(231,76,60,0.75)"}
                      opacity={hover == null || hover === i ? 1 : 0.55}
                    />
                  </g>
                );
              })}
              {bench != null ? (
                <g pointerEvents="none">
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={geo.y(bench)}
                    y2={geo.y(bench)}
                    stroke="#9B59B6"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                  />
                </g>
              ) : null}
              <path
                pointerEvents="none"
                d={series.rolling
                  .map((v, i) => `${i ? "L" : "M"}${(PAD.left + i * geo.step + geo.step / 2).toFixed(1)},${geo.y(v).toFixed(1)}`)
                  .join(" ")}
                fill="none"
                stroke="#ff5500"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              {[...new Set([0, Math.floor(series.points.length / 2), series.points.length - 1])].map((i) => {
                // The first and last dates line up with the plot's edges so they aren't cut off.
                const last = series.points.length - 1;
                const anchor = i === 0 ? "start" : i === last ? "end" : "middle";
                const x = i === 0 ? PAD.left : i === last ? width - PAD.right : PAD.left + i * geo.step + geo.step / 2;
                return (
                  <text key={i} x={x} y={HEIGHT - 4} textAnchor={anchor} fill="#6a6a6a" fontSize={10}>
                    {formatMatchWhen(series.points[i].match.date).day}
                  </text>
                );
              })}
            </svg>
          ) : null}

          {hovered && geo ? (
            <div
              className="pointer-events-none absolute z-10 w-[13rem] rounded-xl border border-white/[0.12] bg-[#1a1a1a] p-3 text-[0.8125rem] shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
              style={{
                left: Math.min(Math.max(0, PAD.left + (hover ?? 0) * geo.step + geo.step / 2 - 104), Math.max(0, width - 208)),
                top: 8,
              }}
            >
              <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[#8a8a8a]">
                {formatMatchWhen(hovered.match.date).day} · {formatMatchWhen(hovered.match.date).time}
              </div>
              <div className="mt-1 flex items-center gap-2 font-extrabold">
                <span className={hovered.match.result === "W" ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{hovered.match.result}</span>
                {hovered.match.rounds ? <span className="tabular-nums text-white">{formatScoreDisplay(hovered.match.rounds)}</span> : null}
                <span className="truncate font-medium text-[#8a8a8a]">{hovered.match.map}</span>
              </div>
              <div className="mt-1.5 flex justify-between text-[#8a8a8a]">
                <span>{def.label}</span>
                <b className="tabular-nums text-white">{def.format(hovered.value)}</b>
              </div>
              <div className="mt-1 flex justify-between text-[#8a8a8a]">
                <span>K/D/A</span>
                <b className="tabular-nums text-white">
                  {hovered.match.kills} / {hovered.match.deaths} / {hovered.match.assists}
                </b>
              </div>
              {hovered.match.eloAfter != null ? (
                <div className="mt-1 flex justify-between text-[#8a8a8a]">
                  <span>Elo</span>
                  <b className="tabular-nums text-white">
                    {hovered.match.eloAfter} ({signed(hovered.match.eloChange || 0)})
                  </b>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {series.points.length >= 2 && series.best && series.worst ? (
          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1">
            <SideBox
              title="Last 5 matches"
              value={<span className={better ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{def.format(series.last5)}</span>}
              aside={
                <span className={`inline-flex items-center gap-0.5 text-[0.8125rem] font-bold ${better ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
                  {better ? <ArrowUp className="h-[0.8125rem] w-[0.8125rem]" strokeWidth={2.6} /> : <ArrowDown className="h-[0.8125rem] w-[0.8125rem]" strokeWidth={2.6} />}
                  {better ? "above" : "below"} avg
                </span>
              }
              sub={`Range average ${def.format(series.average)}`}
            />
            <SideBox
              title="Best match"
              value={<span className="text-white">{def.format(series.best.value)}</span>}
              aside={<span className="truncate text-xs text-[#8a8a8a]">{series.best.match.map}</span>}
              sub={`${formatMatchWhen(series.best.match.date).day} · ${series.best.match.kills} / ${series.best.match.deaths} / ${series.best.match.assists}`}
            />
            <SideBox
              title="Worst match"
              value={<span className="text-white">{def.format(series.worst.value)}</span>}
              aside={<span className="truncate text-xs text-[#8a8a8a]">{series.worst.match.map}</span>}
              sub={`${formatMatchWhen(series.worst.match.date).day} · ${series.worst.match.kills} / ${series.worst.match.deaths} / ${series.worst.match.assists}`}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
