/**
 * Per-instance TTL cache with in-flight coalescing. Vercel instances don't
 * share this — it only stops the same instance repeating work a few seconds
 * later (leaderboard, equipped cosmetics, public stats).
 */

type Slot<T> = { at: number; value: T | undefined; inflight: Promise<T> | null };

const slots = new Map<string, Slot<unknown>>();

export async function remember<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const slot = (slots.get(key) as Slot<T> | undefined) ?? { at: 0, value: undefined, inflight: null };
  if (slot.value !== undefined && now - slot.at < ttlMs) return slot.value;
  if (slot.inflight) return slot.inflight;

  const inflight = fn()
    .then((value) => {
      slots.set(key, { at: Date.now(), value, inflight: null });
      return value;
    })
    .catch((err) => {
      const cur = slots.get(key) as Slot<T> | undefined;
      if (cur) cur.inflight = null;
      throw err;
    });

  slots.set(key, { at: slot.at, value: slot.value, inflight });
  return inflight;
}
