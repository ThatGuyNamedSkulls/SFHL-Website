"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Match } from "@/types";

interface MetricChartProps {
  /** Matches newest → oldest (as returned by the API). */
  matches: Match[];
}

const METRICS = [
  { id: "kd", label: "K/D", pick: (m: Match) => m.kdr, decimals: 2 },
  { id: "swing", label: "Swing", pick: (m: Match) => m.eloChange, decimals: 0 },
  { id: "hs", label: "HS %", pick: (m: Match) => m.headshotPercent, decimals: 0 },
  { id: "score", label: "Score", pick: (m: Match) => m.score, decimals: 0 },
] as const;

type MetricId = (typeof METRICS)[number]["id"];

/**
 * FACEIT-style per-match metric chart: pill selector (K/D, Swing, HS %, Score)
 * over a line chart, with highest/lowest chips on the side.
 */
export function MetricChart({ matches }: MetricChartProps) {
  const [metricId, setMetricId] = useState<MetricId>("kd");
  const metric = METRICS.find((m) => m.id === metricId)!;

  const series = useMemo(
    () => [...matches].reverse().map((m, i) => ({ match: i + 1, value: metric.pick(m) })),
    [matches, metric]
  );

  if (series.length < 2) {
    return <p className="text-sm text-hl-muted py-8 text-center">Not enough matches to chart yet.</p>;
  }

  const values = series.map((p) => p.value);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const fmt = (v: number) => v.toFixed(metric.decimals);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {METRICS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMetricId(m.id)}
            className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
              m.id === metricId
                ? "bg-gold-gradient text-hl-base border-transparent"
                : "border-hl-border text-hl-muted hover:text-white"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-[1fr_180px] gap-5">
        <div className="w-full h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="match" tick={{ fill: "#a0a0a0", fontSize: 10 }} axisLine={{ stroke: "#2a2a2a" }} tickLine={false} />
              <YAxis tick={{ fill: "#a0a0a0", fontSize: 10 }} axisLine={{ stroke: "#2a2a2a" }} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => `Match ${v}`}
                formatter={(value) => [fmt(Number(value)), metric.label]}
              />
              <Line type="monotone" dataKey="value" stroke="#8884ff" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#8884ff" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-hl-panel-light/30 border border-hl-border rounded-xl p-4 space-y-3 self-start">
          <div className="text-xs text-hl-muted header-caps">{metric.label}</div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-hl-muted">Highest</span>
            <span className="font-bold text-hl-gold stat-number">{fmt(hi)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-hl-muted">Lowest</span>
            <span className="font-bold text-hl-red stat-number">{fmt(lo)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
