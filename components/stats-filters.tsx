"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter } from "lucide-react";
import {
  RANGE_LABELS,
  RESULT_LABELS,
  type MatchFilters,
} from "@/lib/match-filters";

export { DEFAULT_FILTERS, applyMatchFilters, type MatchFilters } from "@/lib/match-filters";

interface StatsFiltersProps {
  maps: string[];
  /** Gamemodes present in the list; the Mode filter hides with fewer than two. */
  modes?: string[];
  value: MatchFilters;
  onChange: (next: MatchFilters) => void;
  count?: number;
  total?: number;
}

const TRIGGER = "bg-hl-panel border-hl-border text-white text-sm h-9";

/** FACEIT-style filters bar: map, result, mode and time range. */
export function StatsFilters({ maps, modes = [], value, onChange, count, total }: StatsFiltersProps) {
  const set = (patch: Partial<MatchFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Filter className="w-4 h-4 text-hl-muted" aria-hidden />

      <Select value={value.map} onValueChange={(v) => set({ map: v ?? "ALL" })}>
        <SelectTrigger className={`${TRIGGER} min-w-[8.75rem]`} aria-label="Map">
          {/* Labels come from here: a bare <SelectValue /> printed the raw value ("ALL"). */}
          <SelectValue>{(v: string) => (v === "ALL" ? "All maps" : v)}</SelectValue>
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

      <Select value={value.result} onValueChange={(v) => set({ result: (v ?? "ALL") as MatchFilters["result"] })}>
        <SelectTrigger className={`${TRIGGER} min-w-[8rem]`} aria-label="Result">
          <SelectValue>{(v: MatchFilters["result"]) => RESULT_LABELS[v] ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-hl-panel border-hl-border text-white">
          {(Object.keys(RESULT_LABELS) as MatchFilters["result"][]).map((k) => (
            <SelectItem key={k} value={k}>
              {RESULT_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {modes.length > 1 ? (
        <Select value={value.mode} onValueChange={(v) => set({ mode: v ?? "ALL" })}>
          <SelectTrigger className={`${TRIGGER} min-w-[7.5rem]`} aria-label="Mode">
            <SelectValue>{(v: string) => (v === "ALL" ? "All modes" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-hl-panel border-hl-border text-white">
            <SelectItem value="ALL">All modes</SelectItem>
            {modes.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Select value={value.range} onValueChange={(v) => set({ range: (v ?? "ALL") as MatchFilters["range"] })}>
        <SelectTrigger className={`${TRIGGER} min-w-[8.75rem]`} aria-label="Time range">
          <SelectValue>{(v: MatchFilters["range"]) => RANGE_LABELS[v] ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-hl-panel border-hl-border text-white">
          {(Object.keys(RANGE_LABELS) as MatchFilters["range"][]).map((k) => (
            <SelectItem key={k} value={k}>
              {RANGE_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {typeof count === "number" && (
        <span className="text-xs text-hl-muted ml-auto tabular-nums">
          {typeof total === "number" && total !== count
            ? `${count} of ${total} matches`
            : `${count} ${count === 1 ? "match" : "matches"}`}
        </span>
      )}
    </div>
  );
}
