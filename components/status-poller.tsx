"use client";

import { primeClientApi } from "@/lib/client-api";
import { useSession } from "@/components/session-provider";
import { usePolling } from "@/components/use-polling";

/** How often the shell's combined status is fetched (the parts' own polls read it from memory). */
export const STATUS_POLL_MS = 10_000;
/** A part is served from memory while younger than this (covers the ×3 idle slow-down). */
export const STATUS_TTL_MS = 35_000;

/**
 * One request for everything the site shell polls (docs/PERFORMANCE_PLAN.md
 * step 4): GET /api/me/status every 10 s (paused in hidden tabs, slower when
 * idle), each part primed into the client request cache under its usual URL.
 * The bell, party rail, queue pill, VS panel and sidebar keep their own
 * schedules but read `apiGetJson(url, { ttlMs: STATUS_TTL_MS })`, so they only
 * hit the network when this poller isn't keeping them fresh.
 */
export function StatusPoller() {
  const { session } = useSession();
  usePolling(
    async () => {
      const res = await fetch("/api/me/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { parts?: Record<string, { status: number; json: unknown }> };
      for (const [url, part] of Object.entries(data.parts ?? {})) primeClientApi(url, part.status, part.json);
    },
    session?.discordId ? STATUS_POLL_MS : null,
    { restartKey: session?.discordId ?? "" }
  );
  return null;
}
