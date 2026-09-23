/** How many messages each chat in the right-bar panels shows (party, match,
 *  club). Only the most recent ones are fetched and kept on screen. */
export const RAIL_CHAT_MESSAGES = 10;

/** Upper bound any chat API will return in one request. */
export const MAX_CHAT_FETCH = 80;

/** Parse a `?limit=` query value, clamped to 1..MAX_CHAT_FETCH. */
export function parseChatLimit(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(MAX_CHAT_FETCH, Math.floor(n)));
}

/** Keep the newest `RAIL_CHAT_MESSAGES` messages, oldest first, one per id. */
export function lastMessages<T extends { id: number }>(rows: T[], keep = RAIL_CHAT_MESSAGES): T[] {
  const byId = new Map<number, T>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-keep);
}

/** The rail's online-friends badge never shows more than 9 (0 = hidden). */
export const ONLINE_BADGE_CAP = 9;
export function onlineBadgeCount(online: number): number {
  return Math.max(0, Math.min(ONLINE_BADGE_CAP, Math.floor(online)));
}
