"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { regionMeta } from "@/lib/regions";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { useSession } from "@/components/session-provider";

const STORAGE_PREFIX = "hl-match-accepted:";
const PENDING_POLL_MS = 1500;
const IDLE_POLL_MS = 3000;

/** Remember that this player already opened a match room (kept for callers
 *  that mark a lobby as seen). */
export function markMatchAccepted(channelId: string) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}`, "1");
  } catch {
    /* ignore */
  }
}

interface ReadyCheck {
  id: string;
  region: string;
  mode: string;
  status: "pending" | "started" | "failed" | "cancelled";
  remainingMs: number;
  total: number;
  accepted: number;
  iAccepted: boolean;
  iWasRemoved: boolean;
}

function seen(key: string) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function remember(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

/**
 * FACEIT-style ready check. When the queue fills, every player must press
 * Accept within 20 seconds. If everyone does, this opens the match room; if
 * not, players who didn't accept are removed from the queue and everyone else
 * keeps searching.
 */
export function MatchReadyModal() {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSession();
  const [check, setCheck] = useState<ReadyCheck | null>(null);
  const [deadlineAt, setDeadlineAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const redirecting = useRef<string | null>(null);

  const apply = useCallback((next: ReadyCheck | null) => {
    setCheck(next);
    if (next) setDeadlineAt(Date.now() + next.remainingMs);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ready-check", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { check?: ReadyCheck | null };
      apply(data.check ?? null);
    } catch {
      /* next poll retries */
    }
  }, [apply]);

  const pending = check?.status === "pending";
  const pollMs = pending ? PENDING_POLL_MS : IDLE_POLL_MS;

  useEffect(() => {
    if (!session?.discordId) return;
    const first = window.setTimeout(load, 0);
    const id = window.setInterval(load, pollMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [session?.discordId, load, pollMs]);

  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [pending]);

  // Everyone accepted: go straight to the match room once it exists.
  useEffect(() => {
    if (check?.status !== "started" || !check.iAccepted) return;
    const key = `hl-ready-redirect:${check.id}`;
    if (seen(key) || redirecting.current === check.id) return;
    redirecting.current = check.id;
    let stop = false;
    const tryOpen = async () => {
      try {
        const res = await fetch("/api/lobby", { cache: "no-store" });
        const data = (await res.json()) as { lobby?: { channelId: string } | null };
        if (data.lobby?.channelId && !stop) {
          remember(key);
          markMatchAccepted(data.lobby.channelId);
          router.push("/match/live");
          return true;
        }
      } catch {
        /* retry */
      }
      return false;
    };
    const id = window.setInterval(async () => {
      if (await tryOpen()) window.clearInterval(id);
    }, 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [check?.status, check?.iAccepted, check?.id, router]);

  const accept = async () => {
    if (!check || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ready-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: check.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Could not accept.");
      else if (data.check) apply(data.check);
    } catch {
      setError("Could not accept.");
    } finally {
      setBusy(false);
    }
  };

  if (!session || !check || check.status === "cancelled") return null;
  const outcomeKey = `hl-ready-outcome:${check.id}`;
  if (check.status === "failed" && (dismissed === check.id || seen(outcomeKey))) return null;
  if (check.status === "started" && (!check.iAccepted || pathname === "/match/live")) return null;

  const regionLabel = `${regionMeta(check.region).label} ${MATCH_MODE_LABEL}${
    check.mode === "super" ? " · Super Match" : ""
  }`;
  const remaining = Math.max(0, deadlineAt - now);
  const secs = Math.ceil(remaining / 1000);
  const close = () => {
    remember(outcomeKey);
    setDismissed(check.id);
  };

  let body: React.ReactNode;
  if (check.status === "failed") {
    body = check.iWasRemoved ? (
      <>
        <div className="text-xl font-bold text-white">You didn&apos;t accept</div>
        <p className="text-[13px] text-[#a0a0a0] mt-2">
          The 20 seconds ran out, so you were removed from the queue. Join again when you&apos;re ready.
        </p>
      </>
    ) : (
      <>
        <div className="text-xl font-bold text-white">Back in the queue</div>
        <p className="text-[13px] text-[#a0a0a0] mt-2">
          Not everyone accepted. You kept your place and are still searching for a match.
        </p>
      </>
    );
  } else if (check.status === "started") {
    body = (
      <>
        <div className="text-xl font-bold text-white">Everyone accepted</div>
        <p className="text-[13px] text-[#a0a0a0] mt-2">Opening the match room…</p>
        <div className="mx-auto mt-5 h-8 w-8 rounded-full border-2 border-white/10 border-t-[#ff5500] animate-spin" />
      </>
    );
  } else {
    body = (
      <>
        <div className="text-xl font-bold text-white">
          {check.iAccepted ? "Waiting for other players" : "Match found"}
        </div>
        <div className="text-[13px] text-[#8a8a8a] mt-1">{regionLabel}</div>
        <div className="text-[12px] text-[#8a8a8a] mt-6">Time left to accept</div>
        <div className="text-[42px] leading-none font-black tabular-nums text-[#ff5500] mt-2">{secs}</div>
        <div className="mt-5 flex justify-center gap-1.5" aria-label={`${check.accepted} of ${check.total} accepted`}>
          {Array.from({ length: check.total }).map((_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full ${i < check.accepted ? "bg-hl-green" : "bg-white/15"}`}
            />
          ))}
        </div>
        <div className="mt-2 text-[12px] text-[#a0a0a0] tabular-nums">
          {check.accepted}/{check.total} accepted
        </div>
        {check.iAccepted ? (
          <p className="mt-5 text-[12px] text-[#8a8a8a]">
            If someone doesn&apos;t accept, you stay in the queue and keep searching.
          </p>
        ) : (
          <button
            type="button"
            onClick={accept}
            disabled={busy || remaining <= 0}
            className="mt-6 inline-flex items-center justify-center w-full sm:w-auto min-w-[140px] h-11 rounded-md bg-[#ff5500] text-white text-sm font-black uppercase tracking-wide hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Accepting…" : "Accept"}
          </button>
        )}
        {error ? <p className="mt-3 text-[12px] text-hl-red">{error}</p> : null}
      </>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Match ready check"
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[max(12vh,env(safe-area-inset-top)+1.5rem)] bg-black/70"
    >
      <div className="w-[min(420px,calc(100%-2rem))] rounded-xl bg-[#1a1a1a] border border-white/10 shadow-2xl px-5 py-6 sm:px-8 sm:py-7 text-center">
        {body}
        {check.status === "failed" ? (
          <button
            type="button"
            onClick={close}
            className="mt-6 inline-flex items-center justify-center min-w-[120px] h-10 rounded-md border border-white/15 text-white text-sm font-bold hover:bg-white/5"
          >
            OK
          </button>
        ) : null}
      </div>
    </div>
  );
}
