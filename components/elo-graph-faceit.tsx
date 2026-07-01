"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Match } from "@/types";

interface EloGraphFaceitProps {
  /** ELO values oldest → newest (length = matches + 1). */
  eloHistory: number[];
  /** Matches newest → oldest (as returned by the API). */
  matches: Match[];
}

/**
 * FACEIT-style ELO progression: orange line chart, a strip of W/L dashes
 * below it, and a side panel of aggregate stats.
 */
export function EloGraphFaceit({ eloHistory, matches }: EloGraphFaceitProps) {
  // matches come newest-first; reverse so results line up with eloHistory.
  const results = useMemo(() => [...matches].reverse(), [matches]);

  const data = eloHistory.map((elo, i) => ({ match: i, elo }));
  const minElo = Math.min(...eloHistory);
  const maxElo = Math.max(...eloHistory);

  const wins = matches.filter((m) => m.result === "W").length;
  const losses = matches.length - wins;
  const eloChange = eloHistory.length > 1 ? eloHistory[eloHistory.length - 1] - eloHistory[0] : 0;

  // Longest win streak across the whole history.
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
    <div className="grid lg:grid-cols-[1fr_220px] gap-5">
      <div>
        <div className="w-full h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="eloFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff5500" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ff5500" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="match" tick={{ fill: "#a0a0a0", fontSize: 10 }} axisLine={{ stroke: "#2a2a2a" }} tickLine={false} />
              <YAxis
                domain={[Math.floor(minElo / 50) * 50 - 25, Math.ceil(maxElo / 50) * 50 + 25]}
                tick={{ fill: "#a0a0a0", fontSize: 10 }}
                axisLine={{ stroke: "#2a2a2a" }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => (v === 0 ? "Start" : `Match ${v}`)}
                formatter={(value) => [`${value}`, "ELO"]}
              />
              <Area type="monotone" dataKey="elo" stroke="#ff5500" strokeWidth={2.5} fill="url(#eloFill)" dot={false} activeDot={{ r: 4, fill: "#ff5500" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* W/L dash strip */}
        {results.length > 0 && (
          <div className="flex gap-[3px] mt-2 flex-wrap">
            {results.map((m) => (
              <span
                key={m.id}
                title={`${m.map} — ${m.result} (${m.eloChange > 0 ? "+" : ""}${m.eloChange})`}
                className={`h-2 flex-1 min-w-[3px] rounded-sm ${m.result === "W" ? "bg-hl-green" : "bg-hl-red"}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="bg-hl-panel-light/30 border border-hl-border rounded-xl p-4 space-y-3 self-start">
        <div className="flex items-center justify-between text-sm">
          <span className="text-hl-muted">Wins</span>
          <span className="font-bold text-hl-green">{wins}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-hl-muted">Losses</span>
          <span className="font-bold text-hl-red">{losses}</span>
        </div>
        <div className="h-px bg-hl-border" />
        <div className="flex items-center justify-between text-sm">
          <span className="text-hl-muted">Highest ELO</span>
          <span className="font-bold text-white stat-number">{maxElo}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-hl-muted">Lowest ELO</span>
          <span className="font-bold text-white stat-number">{minElo}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-hl-muted">ELO change</span>
          <span className={`font-bold stat-number ${eloChange >= 0 ? "text-hl-green" : "text-hl-red"}`}>
            {eloChange > 0 ? "+" : ""}
            {eloChange}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-hl-muted">Longest win streak</span>
          <span className="font-bold text-hl-gold stat-number">{longestWin}</span>
        </div>
      </div>
    </div>
  );
}
