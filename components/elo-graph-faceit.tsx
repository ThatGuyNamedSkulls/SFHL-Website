"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Match } from "@/types";

interface EloGraphFaceitProps {
  /** ELO values oldest → newest. A `null` is a season boundary (the line breaks
   *  there: the old season's final Elo and the new season's start are unrelated). */
  eloHistory: (number | null)[];
  /** Matches newest → oldest (as returned by the API). */
  matches: Match[];
  /** Season resets: the index of each break in eloHistory + the season's name. */
  eloResets?: { index: number; label: string }[];
}

/**
 * FACEIT-style ELO progression: orange line from 0, W/L ticks below, stats rail.
 */
export function EloGraphFaceit({ eloHistory, matches }: EloGraphFaceitProps) {
  const results = useMemo(() => [...matches].reverse(), [matches]);

  const data = useMemo(
    () =>
      eloHistory.map((elo, i) => ({
        match: i,
        elo: elo == null ? null : Math.max(0, elo),
      })),
    [eloHistory]
  );

  const values = useMemo(
    () => data.map((d) => d.elo).filter((e): e is number => e !== null),
    [data]
  );
  const minElo = values.length ? Math.min(...values) : 0;
  const maxElo = values.length ? Math.max(...values) : 0;
  const yMax = Math.max(100, Math.ceil(maxElo / 100) * 100);

  const wins = matches.filter((m) => m.result === "W").length;
  const losses = matches.length - wins;

  const eloChange = useMemo(() => {
    const lastBreak = eloHistory.lastIndexOf(null);
    const current = (lastBreak === -1 ? eloHistory : eloHistory.slice(lastBreak + 1))
      .filter((e): e is number => e !== null)
      .map((e) => Math.max(0, e));
    return current.length > 1 ? current[current.length - 1] - current[0] : 0;
  }, [eloHistory]);

  const longestWin = useMemo(() => {
    let best = 0;
    let cur = 0;
    for (const m of results) {
      if (m.result === "W") {
        cur += 1;
        best = Math.max(best, cur);
      } else cur = 0;
    }
    return best;
  }, [results]);

  return (
    <div className="grid lg:grid-cols-[1fr_200px] gap-6">
      <div>
        <div className="w-full h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 4 }}>
              <defs>
                <linearGradient id="eloFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff5500" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#ff5500" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="match" hide />
              <YAxis
                domain={[0, yMax]}
                ticks={[0, yMax / 2, yMax].map((n) => Math.round(n))}
                tick={{ fill: "#6a6a6a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.12)" }}
                contentStyle={{
                  backgroundColor: "#1c1c1c",
                  border: "1px solid #2a2a2a",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => (v === 0 ? "Start" : `Match ${v}`)}
                formatter={(value) => [`${value}`, "ELO"]}
              />
              <Area
                type="linear"
                dataKey="elo"
                stroke="#ff5500"
                strokeWidth={2}
                fill="url(#eloFill)"
                dot={false}
                activeDot={{ r: 4, fill: "#ff5500", stroke: "#111", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {results.length > 0 && (
          <div className="flex gap-px mt-1 px-8">
            {results.map((m) => (
              <span
                key={m.id}
                title={`${m.map} — ${m.result} (${m.eloChange > 0 ? "+" : ""}${m.eloChange})`}
                className={`h-[3px] flex-1 min-w-[2px] ${m.result === "W" ? "bg-[#2ecc71]" : "bg-[#e74c3c]"}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 text-sm self-center">
        <StatRow label="Wins" value={wins} valueClass="text-[#2ecc71]" />
        <StatRow label="Losses" value={losses} valueClass="text-[#e74c3c]" />
        <div className="h-px bg-white/[0.06]" />
        <StatRow label="Highest ELO" value={maxElo} />
        <StatRow label="Lowest ELO" value={minElo} />
        <StatRow
          label="ELO change"
          value={`${eloChange > 0 ? "+" : ""}${eloChange}`}
          valueClass={eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}
        />
        <StatRow label="Longest win streak" value={longestWin} valueClass="text-[#ff5500]" />
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass = "text-white",
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#8a8a8a]">{label}</span>
      <span className={`font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
