"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gamepad2 } from "lucide-react";
import { apiGetJson } from "@/lib/client-api";
import { usePolling } from "@/components/use-polling";
import { signalQueueChanged } from "@/lib/queue-signal";
import { STATUS_TTL_MS } from "@/components/status-poller";

interface QueueEntry {
  discord_id: string;
}

/**
 * Persistent queue-status indicator (FACEIT shows queue state site-wide).
 * Shows "In Queue" if the logged-in user is queued, otherwise a live count.
 * Hidden when the queue is empty and the user isn't in it.
 */
export function QueuePill({ discordId }: { discordId?: string | null }) {
  const [count, setCount] = useState<number | null>(null);
  const [inQueue, setInQueue] = useState(false);
  const wasQueued = useRef<boolean | null>(null);
  // The queue page polls the queue itself; the pill rests there.
  const onQueuePage = usePathname() === "/queue";

  usePolling(
    () =>
      apiGetJson<{ queue?: QueueEntry[] }>("/api/queue", { ttlMs: STATUS_TTL_MS })
        .then(({ json: d }) => {
          const q: QueueEntry[] = d.queue || [];
          const mine = discordId ? q.some((e) => e.discord_id === discordId) : false;
          setCount(q.length);
          setInQueue(mine);
          // Queued from elsewhere (Discord, a party leader): wake the ready-check popup.
          if (wasQueued.current !== null && wasQueued.current !== mine) signalQueueChanged();
          wasQueued.current = mine;
        })
        .catch(() => {}),
    onQueuePage ? null : 10_000
  );
  useEffect(() => {
    wasQueued.current = null;
  }, [discordId]);

  if (count === null || (count === 0 && !inQueue)) return null;

  return (
    <Link
      href="/queue"
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
        inQueue
          ? "bg-hl-green/15 text-hl-green border border-hl-green/30 animate-pulse-glow"
          : "bg-hl-panel-light text-hl-muted border border-hl-border hover:text-white"
      }`}
      title="Go to the queue"
    >
      <Gamepad2 className="w-3.5 h-3.5" />
      {inQueue ? "In Queue" : `${count} in queue`}
    </Link>
  );
}
