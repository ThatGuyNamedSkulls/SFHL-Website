import { PARTY_MAX_SIZE } from "@/lib/match-mode";

export const QUEUE_MODE_STANDARD = "standard";
export const QUEUE_MODE_SUPER = "super";
export const QUEUE_MODES = [QUEUE_MODE_STANDARD, QUEUE_MODE_SUPER] as const;
export type QueueModeId = (typeof QUEUE_MODES)[number];

export const SUPER_PARTY_MAX = 3;
export const SUPER_ELO_RANGE = 400;

export function isQueueMode(value: string): value is QueueModeId {
  return value === QUEUE_MODE_STANDARD || value === QUEUE_MODE_SUPER;
}

export function parseQueueMode(value: unknown): QueueModeId {
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "super" || raw === "super match") return QUEUE_MODE_SUPER;
    if (raw === "standard") return QUEUE_MODE_STANDARD;
  }
  return QUEUE_MODE_STANDARD;
}

export function partyMaxForMatchType(matchType: string | null | undefined): number {
  return parseQueueMode(matchType) === QUEUE_MODE_SUPER ? SUPER_PARTY_MAX : PARTY_MAX_SIZE;
}

export function eloSpread(elos: number[]): number {
  if (!elos.length) return 0;
  return Math.max(...elos) - Math.min(...elos);
}

export function eloRangeOk(elos: number[], maxRange = SUPER_ELO_RANGE): boolean {
  return eloSpread(elos) <= maxRange;
}
