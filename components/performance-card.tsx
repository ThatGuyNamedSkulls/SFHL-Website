"use client";

import { useMemo } from "react";

interface PerformanceCardProps {
  label: string;
  value: string;
  /** Series used to draw the sparkline (oldest → newest). */
  series?: number[];
  /** Optional sub-label under the value. */
  sub?: string;
  accent?: "gold" | "green" | "red" | "teal";
}

const ACCENTS: Record<string, string> = {
  gold: "#ff5500",
  green: "#2ecc71",
  red: "#e74c3c",
  teal: "#ff7733",
};

/** FACEIT-style stat card: big value + inline sparkline. */
export function PerformanceCard({
  label,
  value,
  series = [],
  sub,
  accent = "gold",
}: PerformanceCardProps) {
  const color = ACCENTS[accent];

  const path = useMemo(() => {
    if (series.length < 2) return "";
    const w = 120;
    const h = 36;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / (series.length - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series]);

  return (
    <div className="bg-hl-panel border border-hl-border rounded-xl p-4 flex flex-col justify-between">
      <div className="text-[11px] text-hl-muted header-caps">{label}</div>
      <div className="flex items-end justify-between gap-3 mt-2">
        <div>
          <div className="text-2xl font-black stat-number text-white" style={{ color }}>
            {value}
          </div>
          {sub && <div className="text-[10px] text-hl-muted mt-0.5">{sub}</div>}
        </div>
        {path && (
          <svg viewBox="0 0 120 36" className="w-[120px] h-9 shrink-0" preserveAspectRatio="none">
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )}
      </div>
    </div>
  );
}
