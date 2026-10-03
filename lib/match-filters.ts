/** Match history filters (components/stats-filters.tsx): pure, so tests can import them. */
import { parseDbTime } from "@/lib/profile-stats";

export interface MatchFilters {
  map: string; // "ALL" or a map name
  result: "ALL" | "W" | "L";
  mode: string; // "ALL" or a gamemode ("5v5", "2v2", …)
  range: "ALL" | "7d" | "30d" | "90d";
}

export const DEFAULT_FILTERS: MatchFilters = {
  map: "ALL",
  result: "ALL",
  mode: "ALL",
  range: "ALL",
};

export const RESULT_LABELS: Record<MatchFilters["result"], string> = {
  ALL: "All results",
  W: "Wins",
  L: "Losses",
};

export const RANGE_LABELS: Record<MatchFilters["range"], string> = {
  ALL: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const RANGE_MS: Record<MatchFilters["range"], number | null> = {
  ALL: null,
  "7d": 7 * 864e5,
  "30d": 30 * 864e5,
  "90d": 90 * 864e5,
};

/** Apply a MatchFilters set to a list of matches (database UTC `date`s). */
export function applyMatchFilters<
  T extends { map: string; result: string; date: string; gameMode?: string | null }
>(matches: T[], f: MatchFilters, now = Date.now()): T[] {
  const rangeMs = RANGE_MS[f.range];
  return matches.filter((m) => {
    if (f.map !== "ALL" && m.map !== f.map) return false;
    if (f.result !== "ALL" && m.result !== f.result) return false;
    if (f.mode !== "ALL" && (m.gameMode ?? "") !== f.mode) return false;
    if (rangeMs !== null) {
      const t = parseDbTime(m.date);
      if (t != null && now - t > rangeMs) return false;
    }
    return true;
  });
}
