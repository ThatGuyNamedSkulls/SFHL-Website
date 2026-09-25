import { PARTY_MAX_SIZE } from "@/lib/match-mode";

export const QUEUE_MODE_STANDARD = "standard";
export const QUEUE_MODE_SUPER = "super";
/** Pro Matchmaking: S2+ only (see lib/pro.ts), its own rating ladder. */
export const QUEUE_MODE_PRO = "pro";
/**
 * Pro Matchmaking is switched off (docs/LEAGUE_V2_PLAN.md, Part A): Pro Elo now
 * comes from league matches in Open10 and above (the bot's core/pro_league.py).
 * Same switch as PRO_QUEUE_ENABLED in cogs/queue.py; the queue code stays.
 */
export const PRO_QUEUE_ENABLED = false;
export const QUEUE_MODES = [QUEUE_MODE_STANDARD, QUEUE_MODE_SUPER, QUEUE_MODE_PRO] as const;
export type QueueModeId = (typeof QUEUE_MODES)[number];

export const SUPER_PARTY_MAX = 3;
export const SUPER_ELO_RANGE = 400;

export function isQueueMode(value: string): value is QueueModeId {
  return (QUEUE_MODES as readonly string[]).includes(value);
}

/** "Standard Match" / "Super Match" / "Pro Matchmaking". */
export function queueModeLabel(mode: string | null | undefined): string {
  const m = parseQueueMode(mode);
  if (m === QUEUE_MODE_SUPER) return "Super Match";
  if (m === QUEUE_MODE_PRO) return PRO_QUEUE_ENABLED ? "Pro Matchmaking" : "Pro Matchmaking (old)";
  return "Standard Match";
}

export function parseQueueMode(value: unknown): QueueModeId {
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "super" || raw === "super match") return QUEUE_MODE_SUPER;
    if (raw === "pro" || raw === "pro matchmaking") return QUEUE_MODE_PRO;
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
