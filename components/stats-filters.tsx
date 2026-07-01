"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter } from "lucide-react";

export interface MatchFilters {
  map: string; // "ALL" or a map name
  result: "ALL" | "W" | "L";
  range: "ALL" | "30d" | "90d";
}

export const DEFAULT_FILTERS: MatchFilters = {
  map: "ALL",
  result: "ALL",
  range: "ALL",
};

interface StatsFiltersProps {
  maps: string[];
  value: MatchFilters;
  onChange: (next: MatchFilters) => void;
  count?: number;
}

/** FACEIT-style filters bar: map, result, and time range. */
export function StatsFilters({ maps, value, onChange, count }: StatsFiltersProps) {
  const set = (patch: Partial<MatchFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <Filter className="w-4 h-4 text-hl-muted" />

      <Select value={value.map} onValueChange={(v) => set({ map: v ?? "ALL" })}>
        <SelectTrigger className="w-[150px] bg-hl-panel border-hl-border text-white text-sm">
          <SelectValue placeholder="Map" />
        </SelectTrigger>
        <SelectContent className="bg-hl-panel border-hl-border text-white">
          <SelectItem value="ALL">All maps</SelectItem>
          {maps.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.result}
        onValueChange={(v) => set({ result: v as MatchFilters["result"] })}
      >
        <SelectTrigger className="w-[130px] bg-hl-panel border-hl-border text-white text-sm">
          <SelectValue placeholder="Result" />
        </SelectTrigger>
        <SelectContent className="bg-hl-panel border-hl-border text-white">
          <SelectItem value="ALL">All results</SelectItem>
          <SelectItem value="W">Wins</SelectItem>
          <SelectItem value="L">Losses</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={value.range}
        onValueChange={(v) => set({ range: v as MatchFilters["range"] })}
      >
        <SelectTrigger className="w-[140px] bg-hl-panel border-hl-border text-white text-sm">
          <SelectValue placeholder="Time range" />
        </SelectTrigger>
        <SelectContent className="bg-hl-panel border-hl-border text-white">
          <SelectItem value="ALL">All time</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="90d">Last 90 days</SelectItem>
        </SelectContent>
      </Select>

      {typeof count === "number" && (
        <span className="text-xs text-hl-muted ml-auto">
          {count} match{count === 1 ? "" : "es"}
        </span>
      )}
    </div>
  );
}

/** Apply a MatchFilters set to a list of matches (with a `date`, `map`, `result`). */
export function applyMatchFilters<
  T extends { map: string; result: string; date: string }
>(matches: T[], f: MatchFilters): T[] {
  const now = Date.now();
  const rangeMs =
    f.range === "30d" ? 30 * 864e5 : f.range === "90d" ? 90 * 864e5 : null;

  return matches.filter((m) => {
    if (f.map !== "ALL" && m.map !== f.map) return false;
    if (f.result !== "ALL" && m.result !== f.result) return false;
    if (rangeMs !== null) {
      const t = Date.parse(m.date);
      if (!Number.isNaN(t) && now - t > rangeMs) return false;
    }
    return true;
  });
}
