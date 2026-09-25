"use client";

/**
 * Team page "Performance statistics" (docs/LEAGUE_V2_PLAN.md D4): one line per
 * player over the team's league matches with a scoreboard, a metric dropdown
 * (K/D, kills, HS%, score) and player chips that are also the legend. Colours
 * follow the player (the eight dark-surface categorical slots, validated on
 * #121212 — never cycled), crosshair + tooltip on hover, and a table view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import type { PerfValues, TeamSummary } from "@/lib/team-stats";

/** Categorical slots 1–8, dark steps (dataviz reference palette; validated vs #121212). */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

const METRICS: { key: keyof PerfValues; label: string; fmt: (n: number) => string }[] = [
  { key: "kd", label: "K/D", fmt: (n) => n.toFixed(2) },
  { key: "kills", label: "Kills", fmt: (n) => String(n) },
  { key: "hs", label: "Headshot %", fmt: (n) => `${n.toFixed(1)}%` },
  { key: "score", label: "Score per map", fmt: (n) => String(n) },
];

const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

/** Tick values: a count (2–6) whose step is a round number (1, 2, 2.5, 5 × 10^k). */
function niceTicks(max: number): number[] {
  const round = (step: number) => {
    const m = step / 10 ** Math.floor(Math.log10(step));
    return [1, 2, 2.5, 5, 10].some((r) => Math.abs(m - r) < 1e-9);
  };
  const n = [4, 5, 3, 6, 2].find((c) => round(max / c)) ?? 4;
  return Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
}

/** End-of-line labels: sorted by height and pushed apart so they never overlap. */
function spreadLabels<T extends { y: number }>(labels: T[], gap = 12): T[] {
  const out = [...labels].sort((a, b) => a.y - b.y).map((l) => ({ ...l }));
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
  return out;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function TeamPerformanceChart({ data }: { data: TeamSummary["performance"] }) {
  const { players, points } = data;
  const colorOf = (p: string) => SERIES[players.indexOf(p)] ?? "#888";
  const [shown, setShown] = useState<string[]>(() => players.slice(0, 3));
  const [metric, setMetric] = useState<keyof PerfValues>("kd");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(280, Math.round(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = METRICS.find((x) => x.key === metric)!;
  const series = players.filter((p) => shown.includes(p));
  const max = useMemo(
    () => niceMax(Math.max(0, ...points.flatMap((pt) => series.map((p) => pt.values[p]?.[metric] ?? 0)))),
    [points, series, metric]
  );
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = niceTicks(max);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 60))));

  if (!points.length) {
    return (
      <div ref={box} className="py-8 text-center text-sm text-white/50">
        No scoreboards yet: the chart fills in as Match Staff save them.
      </div>
    );
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  const hp = hover === null ? null : points[hover];

  return (
    <div ref={box}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Players (legend)">
          {players.map((p) => {
            const on = shown.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => setShown((s) => (on ? s.filter((q) => q !== p) : [...s, p]))}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${
                  on ? "border-white/25 bg-white/[0.07] text-white" : "border-white/[0.08] text-white/45 hover:text-white/80"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? colorOf(p) : "transparent", boxShadow: `inset 0 0 0 2px ${colorOf(p)}` }} />
                {p}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <span className="sr-only">Metric</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as keyof PerfValues)}
              className="h-9 appearance-none rounded-lg border border-white/[0.12] bg-[#1b1b1b] pl-3 pr-8 text-xs font-bold text-white outline-none focus:border-[#ff5500]"
            >
              {METRICS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
          </label>
          <button
            type="button"
            aria-pressed={table}
            onClick={() => setTable((t) => !t)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold ${
              table ? "border-[#ff5500]/60 text-white" : "border-white/[0.12] text-white/70 hover:text-white"
            }`}
          >
            <Table2 className="h-3.5 w-3.5" /> Table
          </button>
        </div>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-white/45">
                <th className="py-2 pr-3 font-semibold">Match</th>
                {series.map((p) => (
                  <th key={p} className="px-2 py-2 text-right font-semibold">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((pt, i) => (
                <tr key={pt.matchId} className="border-t border-white/[0.05]">
                  <td className="py-1.5 pr-3 text-white/70">
                    #{i + 1} {pt.label}
                  </td>
                  {series.map((p) => (
                    <td key={p} className="px-2 py-1.5 text-right tabular-nums text-white/85">
                      {pt.values[p] ? m.fmt(pt.values[p][metric]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg width={width} height={H} role="img" aria-label={`${m.label} per match for ${series.join(", ") || "no players"}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
                <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" className="fill-white/40 text-[10px] tabular-nums">
                  {m.fmt(t)}
                </text>
              </g>
            ))}
            {points.map((pt, i) =>
              i % labelEvery === 0 || i === points.length - 1 ? (
                <text key={pt.matchId} x={x(i)} y={H - 8} textAnchor="middle" className="fill-white/40 text-[10px] tabular-nums">
                  #{i + 1}
                </text>
              ) : null
            )}
            {hp ? <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.25)" /> : null}
            {series.map((p) => {
              const pts = points.map((pt, i) => (pt.values[p] ? ([x(i), y(pt.values[p][metric])] as const) : null));
              const path = pts
                .map((q, i) => (q ? `${i === 0 || !pts[i - 1] ? "M" : "L"}${q[0].toFixed(1)},${q[1].toFixed(1)}` : ""))
                .join("");
              return (
                <g key={p}>
                  <path d={path} fill="none" stroke={colorOf(p)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((q, i) =>
                    q ? (
                      <circle key={i} cx={q[0]} cy={q[1]} r={hover === i ? 5 : 4} fill={colorOf(p)} stroke="#121212" strokeWidth={2} />
                    ) : null
                  )}
                </g>
              );
            })}
            {series.length <= 4
              ? spreadLabels(
                  series.flatMap((p) => {
                    const i = points.map((pt) => !!pt.values[p]).lastIndexOf(true);
                    return i < 0 ? [] : [{ p, x: x(i), y: y(points[i].values[p][metric]) - 8 }];
                  })
                ).map((l) => (
                  <text
                    key={l.p}
                    x={l.x + 60 > width ? l.x - 6 : l.x + 6}
                    y={l.y}
                    textAnchor={l.x + 60 > width ? "end" : "start"}
                    className="fill-white/70 text-[10px] font-bold"
                  >
                    {l.p}
                  </text>
                ))
              : null}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
          {hp ? (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border border-white/10 bg-[#1b1b1b]/95 px-3 py-2 text-xs shadow-xl"
              style={x(hover!) > width / 2 ? { right: width - x(hover!) + 12 } : { left: x(hover!) + 12 }}
            >
              <div className="mb-1 font-black text-white">
                #{hover! + 1} {hp.label}
              </div>
              {hp.date ? (
                <div className="mb-1.5 text-[10px] text-white/45">
                  {new Date(hp.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              ) : null}
              {series.map((p) => (
                <div key={p} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-white/70">
                    <span className="h-2 w-2 rounded-full" style={{ background: colorOf(p) }} />
                    {p}
                  </span>
                  <span className="font-bold tabular-nums text-white">{hp.values[p] ? m.fmt(hp.values[p][metric]) : "—"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
