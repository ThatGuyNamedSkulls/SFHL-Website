"use client";

/**
 * Browser GET helper: in-flight requests to the same URL share one network
 * round-trip, and a short TTL can reuse the last JSON body. Mutations should
 * call `invalidateClientApi` so the next read is fresh.
 */

type Entry = { at: number; ok: boolean; status: number; json: unknown };

const inflight = new Map<string, Promise<Entry>>();
const memo = new Map<string, Entry>();

export function invalidateClientApi(url?: string) {
  if (url) {
    memo.delete(url);
    inflight.delete(url);
    return;
  }
  memo.clear();
  inflight.clear();
}

export async function apiGetJson<T = unknown>(
  url: string,
  opts?: { ttlMs?: number; force?: boolean }
): Promise<{ ok: boolean; status: number; json: T }> {
  if (opts?.force) memo.delete(url);
  const ttl = opts?.force ? 0 : opts?.ttlMs ?? 0;
  const hit = memo.get(url);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) {
    return { ok: hit.ok, status: hit.status, json: hit.json as T };
  }

  let pending = inflight.get(url);
  if (!pending) {
    pending = fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        const entry: Entry = { at: Date.now(), ok: r.ok, status: r.status, json };
        memo.set(url, entry);
        return entry;
      })
      .finally(() => {
        inflight.delete(url);
      });
    inflight.set(url, pending);
  }

  const entry = await pending;
  return { ok: entry.ok, status: entry.status, json: entry.json as T };
}
