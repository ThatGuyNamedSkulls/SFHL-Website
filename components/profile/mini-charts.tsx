import type { ReactNode } from "react";

/** A small trend line (values oldest → newest). Nothing for fewer than 2 values. */
export function Sparkline({
  values,
  color = "#ff5500",
  className = "w-[5.25rem] h-[1.875rem]",
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const w = 84;
  const h = 30;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`shrink-0 ${className}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A progress ring (0–100) with optional content in the middle. */
export function Ring({
  percent,
  size = 44,
  stroke = 5,
  color = "#ff5500",
  children,
  label,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a2a" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
          strokeLinecap="round"
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  );
}
