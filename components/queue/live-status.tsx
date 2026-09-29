"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Swords, Volume2, VolumeX } from "lucide-react";
import { formatElapsed } from "@/lib/queue-attention";
import { setQueueSoundMuted, unlockQueueAudio, useQueueSoundMuted } from "@/lib/queue-sounds";
import { useReadyCheck } from "@/components/use-ready-check";
import { useNow } from "@/components/use-now";
import { Ring } from "@/components/queue/ring";

/** Mute / unmute the queue sounds (remembered in this browser). */
export function SoundToggle() {
  const muted = useQueueSoundMuted();
  return (
    <button
      type="button"
      onClick={() => {
        unlockQueueAudio();
        setQueueSoundMuted(!muted);
      }}
      aria-pressed={!muted}
      title={muted ? "Queue sounds are off" : "Queue sounds are on"}
      className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 hover:text-white"
    >
      {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      <span className="sr-only">{muted ? "Turn queue sounds on" : "Turn queue sounds off"}</span>
    </button>
  );
}

/** mm:ss since you joined the queue (server time when known). */
export function useSearchElapsed(active: boolean): string | null {
  const { queuedSince } = useReadyCheck();
  const [localStart, setLocalStart] = useState<number | null>(null);
  const now = useNow(active);
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setLocalStart((s) => s ?? Date.now()), 0);
    return () => window.clearTimeout(id);
  }, [active]);
  if (!active) return null;
  const since = queuedSince ?? localStart ?? now;
  return formatElapsed(now - since);
}


/** Searching: the timer and how full the lobby is. */
export function SearchStatus({
  elapsed,
  inQueue,
  needed,
  regionLabel,
  modeLabel,
}: {
  elapsed: string;
  inQueue: number;
  needed: number;
  regionLabel: string;
  modeLabel: string;
}) {
  const found = Math.min(inQueue, needed);
  return (
    <div className="flex items-center justify-center gap-5" aria-live="polite">
      <Ring value={found / needed} size={72} stroke={6} color="#2ecc71">
        <span className="stat-number text-sm font-black text-white">
          {found}/{needed}
        </span>
      </Ring>
      <div>
        <div className="text-[0.75rem] font-black uppercase tracking-[0.14em] text-hl-green">Searching</div>
        <div className="stat-number text-4xl font-black leading-none text-white">{elapsed}</div>
        <div className="mt-1 text-xs text-white/60">
          {regionLabel} · {modeLabel} · {found} of {needed} players
        </div>
      </div>
    </div>
  );
}

/** In a live match: which one, and the way back to it. */
export function InMatchCard({ lobby }: { lobby: { name: string; map: string | null; number: number | null } }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-hl-green/35 bg-hl-green/[0.06] p-4 md:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-hl-green/15 text-hl-green">
          <Swords className="h-5 w-5" />
        </span>
        <div>
          <div className="text-base font-black text-white">You&apos;re in a match</div>
          <div className="text-xs text-white/60">
            {lobby.number ? `Match #${lobby.number}` : lobby.name}
            {lobby.map ? ` · ${lobby.map}` : " · map veto in progress"}
          </div>
        </div>
      </div>
      <Link href="/match/live" className="header-caps rounded-lg bg-hl-green px-6 py-2.5 text-sm font-black text-hl-base hover:brightness-110">
        Open match room
      </Link>
    </section>
  );
}
