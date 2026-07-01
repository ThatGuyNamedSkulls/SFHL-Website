"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gamepad2 } from "lucide-react";

interface QueueEntry {
  discord_user_id: string;
}

/**
 * Persistent queue-status indicator (FACEIT shows queue state site-wide).
 * Shows "In Queue" if the logged-in user is queued, otherwise a live count.
 * Hidden when the queue is empty and the user isn't in it.
 */
export function QueuePill({ discordId }: { discordId?: string | null }) {
  const [count, setCount] = useState<number | null>(null);
  const [inQueue, setInQueue] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/queue")
        .then((r) => r.json())
        .then((d) => {
          if (!active) return;
          const q: QueueEntry[] = d.queue || [];
          setCount(q.length);
          setInQueue(
            discordId ? q.some((e) => e.discord_user_id === discordId) : false
          );
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(id);
    };
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
