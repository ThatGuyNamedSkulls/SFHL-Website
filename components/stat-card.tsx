"use client";

import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string | number;
  /** Optional delta/change indicator (e.g. "+2.3") */
  delta?: string;
  /** Color accent for the value — maps to HyperLeague palette */
  accent?: "gold" | "teal" | "green" | "red" | "default";
  /** Optional icon node */
  icon?: React.ReactNode;
  className?: string;
}

const accentColors = {
  gold: "text-hl-gold",
  teal: "text-hl-teal",
  green: "text-hl-green",
  red: "text-hl-red",
  default: "text-white",
};

/**
 * Reusable stat tile — label + large value + optional delta.
 * Built on shadcn Card, styled with HyperLeague accent colors.
 */
export function StatCard({
  label,
  value,
  delta,
  accent = "default",
  icon,
  className = "",
}: StatCardProps) {
  const deltaIsPositive = delta && !delta.startsWith("-");

  return (
    <Card
      className={`
        bg-hl-panel border-hl-border p-4
        card-hover-glow transition-all duration-300
        ${className}
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs header-caps text-hl-muted">{label}</span>
        {icon && <span className="text-hl-muted">{icon}</span>}
      </div>
      <div className={`stat-number text-2xl ${accentColors[accent]}`}>
        {value}
      </div>
      {delta && (
        <div
          className={`text-xs mt-1 font-medium ${
            deltaIsPositive ? "text-hl-green" : "text-hl-red"
          }`}
        >
          {deltaIsPositive ? "▲" : "▼"} {delta}
        </div>
      )}
    </Card>
  );
}
