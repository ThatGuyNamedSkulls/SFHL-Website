/**
 * Track URLs (docs/TRACK_UI_PLAN.md): /track/<name>, with the tab and the
 * filters in the query (?tab=maps&range=30d&map=…&mode=…). Pure, so client
 * components and tests can import it.
 */

export const TRACK_TABS = ["stats", "matches", "maps"] as const;
export type TrackTab = (typeof TRACK_TABS)[number];

export function isTrackTab(value: string | null | undefined): value is TrackTab {
  return !!value && (TRACK_TABS as readonly string[]).includes(value);
}

export const TRACK_RANGES = ["last20", "last50", "7d", "30d", "season", "career"] as const;
export type TrackRange = (typeof TRACK_RANGES)[number];

/** Last 20 matches by default (Q3). */
export const DEFAULT_TRACK_RANGE: TrackRange = "last20";

export const TRACK_RANGE_LABELS: Record<TrackRange, string> = {
  last20: "Last 20 matches",
  last50: "Last 50 matches",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  season: "This season",
  career: "Career",
};

export function isTrackRange(value: string | null | undefined): value is TrackRange {
  return !!value && (TRACK_RANGES as readonly string[]).includes(value);
}

/** "/track/frostbyte", "/track/frostbyte?tab=maps&range=30d". Defaults are left out. */
export function trackHref(
  name: string,
  opts: { tab?: TrackTab; range?: TrackRange; map?: string | null; mode?: string | null } = {}
): string {
  const params = new URLSearchParams();
  if (opts.tab && opts.tab !== "stats") params.set("tab", opts.tab);
  if (opts.range && opts.range !== DEFAULT_TRACK_RANGE) params.set("range", opts.range);
  if (opts.map) params.set("map", opts.map);
  if (opts.mode) params.set("mode", opts.mode);
  const query = params.toString();
  return `/track/${encodeURIComponent(name.trim())}${query ? `?${query}` : ""}`;
}
