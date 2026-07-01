"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
} from "recharts";
import { EloDataPoint } from "@/types";

interface EloChartProps {
  /** Array of ELO values (will be indexed as match 1, 2, 3...) */
  eloHistory: number[];
  className?: string;
}

/**
 * ELO trend line chart using Recharts.
 * Shows green/gold gradient line with min/max markers.
 */
export function EloChart({ eloHistory, className = "" }: EloChartProps) {
  // Transform raw array into chart data points
  const data: EloDataPoint[] = eloHistory.map((elo, i) => ({
    match: i + 1,
    elo,
    date: `Match ${i + 1}`,
  }));

  const minElo = Math.min(...eloHistory);
  const maxElo = Math.max(...eloHistory);
  const minIdx = eloHistory.indexOf(minElo);
  const maxIdx = eloHistory.indexOf(maxElo);

  return (
    <div className={className}>
      <div className="w-full h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="eloGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#2ecc71" />
                <stop offset="100%" stopColor="#ff5500" />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255, 255, 255, 0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="match"
              tick={{ fill: "#a0a0a0", fontSize: 11 }}
              axisLine={{ stroke: "#333333" }}
              tickLine={false}
            />
            <YAxis
              domain={[
                Math.floor(minElo / 50) * 50 - 50,
                Math.ceil(maxElo / 50) * 50 + 50,
              ]}
              tick={{ fill: "#a0a0a0", fontSize: 11 }}
              axisLine={{ stroke: "#333333" }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f1f1f",
                border: "1px solid #333333",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "12px",
              }}
              labelFormatter={(v) => `Match ${v}`}
              formatter={(value) => [`${value}`, "ELO"]}
            />
            <Line
              type="monotone"
              dataKey="elo"
              stroke="url(#eloGradient)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 5,
                fill: "#ff5500",
                stroke: "#121212",
                strokeWidth: 2,
              }}
            />
            {/* Min marker */}
            <ReferenceDot
              x={minIdx + 1}
              y={minElo}
              r={4}
              fill="#e74c3c"
              stroke="#121212"
              strokeWidth={2}
            />
            {/* Max marker */}
            <ReferenceDot
              x={maxIdx + 1}
              y={maxElo}
              r={4}
              fill="#2ecc71"
              stroke="#121212"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-xs text-hl-muted mt-2 px-1">
        <span>
          Min: <span className="text-hl-red font-semibold">{minElo}</span>
        </span>
        <span>
          Max: <span className="text-hl-green font-semibold">{maxElo}</span>
        </span>
      </div>
    </div>
  );
}
