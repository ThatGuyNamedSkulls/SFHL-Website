/** Matchmaking regions staff open with `/queue REGION` in Discord. */

import { MATCH_TEAM_SIZE } from "@/lib/match-mode";

export const QUEUE_REGIONS = [
  { id: "EU", label: "Europe", short: "EU" },
  { id: "NA", label: "North America", short: "NA" },
  { id: "SA", label: "South America", short: "SA" },
  { id: "APAC", label: "Asia-Pacific", short: "APAC" },
  { id: "OC", label: "Oceania", short: "OC" },
] as const;

export const PLAY_REGIONS = [
  { id: "GLOBAL", label: "Global", short: "Global" },
  ...QUEUE_REGIONS,
] as const;

export type QueueRegionId = (typeof QUEUE_REGIONS)[number]["id"];
export type PlayRegionId = (typeof PLAY_REGIONS)[number]["id"];

export const DEFAULT_PLAY_REGION: PlayRegionId = "GLOBAL";
export const REGION_STORAGE_KEY = "hl_view_region";
export const REGION_CHANGE_EVENT = "hl-region-change";

const PLAY_REGION_IDS = new Set<string>(PLAY_REGIONS.map((r) => r.id));
const QUEUE_REGION_IDS = new Set<string>(QUEUE_REGIONS.map((r) => r.id));

export function isPlayRegion(value: string): value is PlayRegionId {
  return PLAY_REGION_IDS.has(value);
}

export function isQueueRegion(value: string): value is QueueRegionId {
  return QUEUE_REGION_IDS.has(value);
}

export function isGlobalRegion(value: string): boolean {
  return value === "GLOBAL";
}

export function regionMeta(id: string) {
  return PLAY_REGIONS.find((r) => r.id === id) ?? PLAY_REGIONS[0];
}

export function regionQueueLabel(id: string, teamSize = MATCH_TEAM_SIZE) {
  if (!isQueueRegion(id)) return `Select a region · ${teamSize}v${teamSize}`;
  return `${regionMeta(id).label} ${teamSize}v${teamSize} Queue`;
}
