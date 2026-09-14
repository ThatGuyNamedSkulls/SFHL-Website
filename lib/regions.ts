/** Matchmaking regions staff open with `/queue REGION` in Discord. */

import { MATCH_TEAM_SIZE } from "@/lib/match-mode";

export const PLAY_REGIONS = [
  { id: "EU", label: "Europe", short: "EU" },
  { id: "NA", label: "North America", short: "NA" },
  { id: "SA", label: "South America", short: "SA" },
  { id: "APAC", label: "Asia-Pacific", short: "APAC" },
  { id: "OC", label: "Oceania", short: "OC" },
] as const;

export type PlayRegionId = (typeof PLAY_REGIONS)[number]["id"];

export const DEFAULT_PLAY_REGION: PlayRegionId = "EU";
export const REGION_STORAGE_KEY = "hl_play_region";
export const REGION_CHANGE_EVENT = "hl-region-change";

const REGION_IDS = new Set<string>(PLAY_REGIONS.map((r) => r.id));

export function isPlayRegion(value: string): value is PlayRegionId {
  return REGION_IDS.has(value);
}

export function regionMeta(id: string) {
  return PLAY_REGIONS.find((r) => r.id === id) ?? PLAY_REGIONS[0];
}

export function regionQueueLabel(id: string, teamSize = MATCH_TEAM_SIZE) {
  return `${regionMeta(id).label} ${teamSize}v${teamSize} Queue`;
}
