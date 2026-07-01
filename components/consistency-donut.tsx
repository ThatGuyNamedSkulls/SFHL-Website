"use client";

interface ConsistencyDonutProps {
  /** 0–100 */
  percent: number;
  label?: string;
  size?: number;
  color?: string;
}

/** Partial donut / ring chart used for the FACEIT "Consistency" card. */
export function ConsistencyDonut({
  percent,
  label = "Consistency",
  size = 96,
  color = "#ff5500",
}: ConsistencyDonutProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#2a2a2a"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-black stat-number text-white">
            {clamped.toFixed(0)}%
          </span>
        </div>
      </div>
      <span className="text-[11px] text-hl-muted header-caps mt-2">{label}</span>
    </div>
  );
}
