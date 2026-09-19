"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LiveLobby } from "@/components/live-match-room";
import { regionMeta } from "@/lib/regions";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { apiGetJson } from "@/lib/client-api";

const ACCEPT_WINDOW_MS = 20_000;
const STORAGE_PREFIX = "hl-match-accepted:";

export function markMatchAccepted(channelId: string) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}`, "1");
  } catch {
    /* ignore */
  }
}

function wasAccepted(channelId: string) {
  try {
    return sessionStorage.getItem(`${STORAGE_PREFIX}${channelId}`) === "1";
  } catch {
    return false;
  }
}

function formatClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(s);
}

/** FACEIT-style "Match ready" overlay. ACCEPT opens the matchroom. */
export function MatchReadyModal() {
  const pathname = usePathname();
  const router = useRouter();
  const [lobby, setLobby] = useState<LiveLobby | null>(null);
  const [regionLabel, setRegionLabel] = useState(MATCH_MODE_LABEL);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [l, q] = await Promise.all([
        apiGetJson<{ lobby?: LiveLobby | null }>("/api/lobby"),
        apiGetJson<{ region?: string; openRegions?: string[] }>("/api/queue"),
      ]);
      const next = (l.json?.lobby as LiveLobby | null) ?? null;
      setLobby(next);
      if (typeof q.json?.region === "string") {
        setRegionLabel(`${regionMeta(q.json.region).label} ${MATCH_MODE_LABEL} Queue`);
      }
      if (Array.isArray(q.json?.openRegions) && q.json.openRegions.length === 1) {
        setRegionLabel(`${regionMeta(q.json.openRegions[0]).label} ${MATCH_MODE_LABEL} Queue`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!lobby?.channelId) {
      setDeadline(0);
      return;
    }
    const key = `${STORAGE_PREFIX}${lobby.channelId}:deadline`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        setDeadline(Number(stored));
        return;
      }
      const d = Date.now() + ACCEPT_WINDOW_MS;
      sessionStorage.setItem(key, String(d));
      setDeadline(d);
    } catch {
      setDeadline(Date.now() + ACCEPT_WINDOW_MS);
    }
  }, [lobby?.channelId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const hide = !lobby || pathname === "/match/live" || wasAccepted(lobby.channelId);
  if (hide) return null;

  const remaining = Math.max(0, deadline - now);

  const accept = () => {
    markMatchAccepted(lobby.channelId);
    router.push("/match/live");
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] bg-black/70">
      <div className="w-[min(420px,calc(100%-2rem))] rounded-xl bg-[#1a1a1a] border border-white/10 shadow-2xl px-8 py-7 text-center">
        <div className="text-xl font-bold text-white">Match ready</div>
        <div className="text-[13px] text-[#8a8a8a] mt-1">{regionLabel}</div>
        <div className="text-[12px] text-[#8a8a8a] mt-6">Time left to accept</div>
        <div className="text-[42px] leading-none font-black tabular-nums text-[#ff5500] mt-2">
          {formatClock(remaining)}
        </div>
        <button
          type="button"
          onClick={accept}
          className="mt-6 inline-flex items-center justify-center min-w-[140px] h-11 rounded-md bg-[#ff5500] text-white text-sm font-black uppercase tracking-wide hover:opacity-90"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
