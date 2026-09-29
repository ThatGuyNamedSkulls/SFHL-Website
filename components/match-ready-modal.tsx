"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { regionMeta } from "@/lib/regions";
import { queueModeLabel } from "@/lib/queue-modes";
import { useSession } from "@/components/session-provider";
import { acceptReadyCheck, useReadyCheck } from "@/components/use-ready-check";
import { Ring } from "@/components/queue/ring";
import { useNow } from "@/components/use-now";
import { ACCEPT_WINDOW_SECONDS } from "@/lib/queue-attention";

const STORAGE_PREFIX = "hl-match-accepted:";
const ACCEPT_WINDOW_MS = ACCEPT_WINDOW_SECONDS * 1000;

/** Remember that this player already opened a match room (kept for callers
 *  that mark a lobby as seen). */
export function markMatchAccepted(channelId: string) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}`, "1");
  } catch {
    /* ignore */
  }
}

export function seenFlag(key: string) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function rememberFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}


/** The pop-up shell: blurred backdrop, a card that scales in. Can't be clicked away. */
function Shell({ children, glow, label }: { children: React.ReactNode; glow: "orange" | "green" | "none"; label: string }) {
  const border = glow === "orange" ? "border-hl-gold/55" : glow === "green" ? "border-hl-green/45" : "border-white/[0.12]";
  const shadow =
    glow === "orange"
      ? "shadow-[0_0_90px_rgba(255,85,0,0.32)]"
      : glow === "green"
        ? "shadow-[0_0_70px_rgba(46,204,113,0.22)]"
        : "shadow-2xl";
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={label}
      className="hl-fade-in fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-[3px]"
    >
      <div className={`hl-pop-in relative w-full max-w-[520px] overflow-hidden rounded-2xl border bg-hl-surface-1 ${border} ${shadow}`}>
        {glow === "orange" ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(ellipse_at_top,rgba(255,85,0,0.38),transparent_70%)]" />
        ) : null}
        {children}
      </div>
    </div>
  );
}

/**
 * FACEIT-style "Match found" pop-up, on every page. When the queue fills,
 * every player must press Accept within ACCEPT_WINDOW_SECONDS. If everyone does, this
 * opens the match room; if not, players who didn't accept are removed from the
 * queue and everyone else keeps searching. State: components/use-ready-check.ts.
 */
export function MatchReadyModal() {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSession();
  const { check, deadlineAt, accepting, error } = useReadyCheck();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const redirecting = useRef<string | null>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const pending = check?.status === "pending";
  const now = useNow(pending);

  // Put focus on Accept as soon as a match is found.
  const focusFor = pending && !check?.iAccepted ? check?.id : null;
  useEffect(() => {
    if (focusFor) acceptRef.current?.focus();
  }, [focusFor]);

  // Everyone accepted: go straight to the match room once it exists.
  useEffect(() => {
    if (check?.status !== "started" || !check.iAccepted) return;
    const key = `hl-ready-redirect:${check.id}`;
    if (seenFlag(key) || redirecting.current === check.id) return;
    redirecting.current = check.id;
    let stop = false;
    const tryOpen = async () => {
      try {
        const res = await fetch("/api/lobby", { cache: "no-store" });
        const data = (await res.json()) as { lobby?: { channelId: string } | null };
        if (data.lobby?.channelId && !stop) {
          rememberFlag(key);
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

  if (!session || !check || check.status === "cancelled") return null;
  const outcomeKey = `hl-ready-outcome:${check.id}`;
  if (check.status === "failed" && (dismissed === check.id || seenFlag(outcomeKey))) return null;
  if (check.status === "started" && (!check.iAccepted || pathname === "/match/live")) return null;

  const subtitle = `${regionMeta(check.region).label} · ${queueModeLabel(check.mode)}`;

  if (check.status === "failed") {
    const close = () => {
      rememberFlag(outcomeKey);
      setDismissed(check.id);
    };
    return (
      <Shell glow="none" label={check.iWasRemoved ? "You didn't accept" : "Back in the queue"}>
        <div className="px-6 py-8 text-center sm:px-8">
          <div className="text-[11px] font-black uppercase tracking-[0.3em] text-white/50">{subtitle}</div>
          <h2 className="mt-2 text-3xl font-black uppercase tracking-wide text-white">
            {check.iWasRemoved ? "Match declined" : "Back in the queue"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/65">
            {check.iWasRemoved
              ? `The ${ACCEPT_WINDOW_SECONDS} seconds ran out, so you were removed from the queue. Find a match again when you're ready.`
              : "Not everyone accepted. You kept your place and are still searching."}
          </p>
          <button
            type="button"
            onClick={close}
            autoFocus
            className="header-caps mt-6 h-11 min-w-[160px] rounded-lg border border-white/15 px-6 text-sm font-black text-white hover:bg-white/[0.06]"
          >
            OK
          </button>
        </div>
      </Shell>
    );
  }

  if (check.status === "started") {
    return (
      <Shell glow="green" label="Everyone accepted">
        <div className="px-6 py-9 text-center sm:px-8">
          <div className="text-[11px] font-black uppercase tracking-[0.3em] text-hl-green">{subtitle}</div>
          <h2 className="mt-2 text-3xl font-black uppercase tracking-wide text-white">Match ready</h2>
          <p className="mt-2 text-sm text-white/65">Everyone accepted. Opening the match room…</p>
          <Loader2 className="mx-auto mt-5 h-7 w-7 animate-spin text-hl-green" />
        </div>
      </Shell>
    );
  }

  const remaining = Math.max(0, deadlineAt - now);
  const secs = Math.ceil(remaining / 1000);
  const urgent = secs <= 5;
  return (
    <Shell glow="orange" label="Match found">
      <div className="relative px-6 pb-7 pt-7 text-center sm:px-8">
        <div className="text-[11px] font-black uppercase tracking-[0.3em] text-hl-teal">{subtitle}</div>
        <h2 className="mt-1 text-4xl font-black uppercase tracking-wide text-white sm:text-5xl">Match found</h2>

        <div className="mt-5 flex justify-center">
          <Ring value={remaining / ACCEPT_WINDOW_MS} size={116} stroke={8} color={urgent ? "#e74c3c" : "#ff5500"}>
            <div>
              <div className={`stat-number text-4xl font-black leading-none ${urgent ? "text-hl-red" : "text-white"}`}>{secs}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/55">seconds</div>
            </div>
          </Ring>
        </div>

        {/* Ten slots that fill as players accept. */}
        <div className="mx-auto mt-5 grid max-w-[300px] grid-cols-5 gap-2" aria-label={`${check.accepted} of ${check.total} accepted`}>
          {Array.from({ length: check.total }).map((_, i) => {
            const ok = i < check.accepted;
            return (
              <span
                key={i}
                className={`grid aspect-square place-items-center rounded-md border transition-colors ${
                  ok ? "border-hl-green/60 bg-hl-green/20 text-hl-green" : "border-white/10 bg-white/[0.03] text-transparent"
                }`}
              >
                <Check className="h-4 w-4" strokeWidth={3} />
              </span>
            );
          })}
        </div>
        <div className="mt-2 text-xs tabular-nums text-white/60">
          {check.accepted}/{check.total} players accepted
        </div>

        {check.iAccepted ? (
          <div className="mt-6 flex h-14 items-center justify-center gap-2 rounded-lg border border-hl-green/40 bg-hl-green/10 text-sm font-black uppercase tracking-wide text-hl-green">
            <Check className="h-4 w-4" strokeWidth={3} /> Accepted · waiting for the others
          </div>
        ) : (
          <button
            ref={acceptRef}
            type="button"
            onClick={() => void acceptReadyCheck()}
            disabled={accepting || remaining <= 0}
            className="find-match-btn header-caps mt-6 h-14 w-full rounded-lg text-xl font-black tracking-wider text-hl-base disabled:opacity-50"
          >
            {accepting ? "Accepting…" : "Accept"}
          </button>
        )}
        {error ? <p className="mt-3 text-sm text-hl-red">{error}</p> : null}
        {check.iAccepted ? (
          <p className="mt-3 text-xs text-white/55">If someone doesn&apos;t accept, you stay in the queue and keep searching.</p>
        ) : null}
      </div>

      {/* The time draining away along the bottom edge. */}
      <div className="h-1.5 w-full bg-white/[0.08]">
        <div
          className={`h-full transition-[width] duration-300 ease-linear ${urgent ? "bg-hl-red" : "bg-hl-gold"}`}
          style={{ width: `${(remaining / ACCEPT_WINDOW_MS) * 100}%` }}
        />
      </div>
    </Shell>
  );
}
