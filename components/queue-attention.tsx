"use client";

/**
 * Site-wide queue attention (docs/QUEUE_UI_PLAN.md §8). Mounted once in the
 * layout, it owns the ready-check poll (components/use-ready-check.ts) and:
 * - plays the queue sounds on transitions (start / end / match found / last 5 s),
 * - puts the search timer, or a flashing MATCH FOUND, in the tab title,
 * - dots the favicon (green searching, orange match found),
 * - sends a desktop notification for a match found in a background tab,
 * - chimes when a queue opens on the player's last picked server.
 */
import { useEffect, useRef } from "react";
import { useSession } from "@/components/session-provider";
import { useMyParty } from "@/components/use-my-party";
import { usePolling } from "@/components/use-polling";
import { STATUS_TTL_MS } from "@/components/status-poller";
import { refreshReadyCheck, resetReadyCheck, useReadyCheck, type ReadyCheck } from "@/components/use-ready-check";
import { apiGetJson } from "@/lib/client-api";
import { QUEUE_EVENT } from "@/lib/queue-signal";
import { baseTitle, queueJustOpened, soundForTransition, titleFor } from "@/lib/queue-attention";
import { playQueueSound, unlockQueueAudio } from "@/lib/queue-sounds";

/** A check is on screen: follow it closely. */
const PENDING_POLL_MS = 1500;
/** Queued (or in a party a leader can queue): a check can start any second. */
const QUEUED_POLL_MS = 3000;
/** Otherwise just a slow safety poll. */
const IDLE_POLL_MS = 30_000;
/** Open-queue watch. Visible tabs read the status poller's cached /api/queue; hidden tabs fetch it. */
const QUEUE_OPEN_POLL_MS = 20_000;

/** Ask for desktop notifications — call from the first Find match click (owner Q3). */
export function askNotificationPermission() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* unsupported */
  }
}

function notifyMatchFound(check: ReadyCheck) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    const n = new Notification("Match found — accept!", {
      body: "You have 20 seconds to accept on HyperLeague.",
      tag: `hl-ready-${check.id}`,
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications blocked or unsupported */
  }
}

let originalIcon: string | null = null;

/** Draw a colored dot on the favicon, or restore it (null). */
function setFaviconDot(color: string | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) return;
  if (originalIcon === null) originalIcon = link.href;
  if (!color) {
    if (link.href !== originalIcon) link.href = originalIcon;
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.drawImage(img, 0, 0, 64, 64);
      g.beginPath();
      g.arc(48, 48, 14, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = "#111111";
      g.stroke();
      link.href = canvas.toDataURL("image/png");
    } catch {
      /* canvas unavailable */
    }
  };
  img.src = originalIcon;
}

export function QueueAttention() {
  const { session } = useSession();
  const { party } = useMyParty(session?.discordId);
  const inParty = !!party && party.members.length > 1;
  const rc = useReadyCheck();
  const pending = rc.check?.status === "pending";
  const urgent = pending || rc.queued || inParty;

  usePolling(refreshReadyCheck, session?.discordId ? (pending ? PENDING_POLL_MS : urgent ? QUEUED_POLL_MS : IDLE_POLL_MS) : null, {
    keepWhenHidden: urgent,
    idleSlowdown: !urgent,
    restartKey: session?.discordId ?? "",
  });

  // Joined / left the queue somewhere on the site: check at once.
  useEffect(() => {
    const onQueue = () => void refreshReadyCheck();
    window.addEventListener(QUEUE_EVENT, onQueue);
    return () => window.removeEventListener(QUEUE_EVENT, onQueue);
  }, []);

  useEffect(() => {
    if (!session?.discordId) resetReadyCheck();
  }, [session?.discordId]);

  // A queue opened on this player's server: chime, even from a background tab.
  const openBefore = useRef<string[] | null>(null);
  usePolling(
    async () => {
      const { ok, json } = await apiGetJson<{ openRegions?: string[]; myRegion?: string | null }>("/api/queue", {
        ttlMs: STATUS_TTL_MS,
      });
      if (!ok || !json) return;
      const open = json.openRegions ?? [];
      if (queueJustOpened(openBefore.current, open, json.myRegion ?? null)) playQueueSound("open");
      openBefore.current = open;
    },
    session?.discordId ? QUEUE_OPEN_POLL_MS : null,
    { keepWhenHidden: true, restartKey: session?.discordId ?? "" }
  );

  // Browsers only play audio after a gesture: unlock on the first click / key.
  useEffect(() => {
    const unlock = () => unlockQueueAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Transition sounds (+ the notification for a new match).
  const prev = useRef<{ queued: boolean; checkId: string | null; checkStatus: string | null } | null>(null);
  const checkId = rc.check?.id ?? null;
  const checkStatus = rc.check?.status ?? null;
  useEffect(() => {
    if (!rc.loaded) return;
    const next = { queued: rc.queued, checkId, checkStatus };
    const sound = soundForTransition(prev.current, next);
    prev.current = next;
    if (sound) playQueueSound(sound);
    if (sound === "found" && rc.check) notifyMatchFound(rc.check);
    // rc.check is read only when the id/status changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rc.loaded, rc.queued, checkId, checkStatus]);

  // Tab title, favicon dot and the countdown ticks (every second of the 20 s).
  const waitingForMe = pending && !rc.check?.iAccepted;
  const mode = waitingForMe ? "found" : rc.queued && rc.queuedSince ? "searching" : "idle";
  const since = rc.queuedSince;
  const deadlineAt = rc.deadlineAt;
  // The last second that ticked, per match. Kept outside the effect: every poll
  // nudges deadlineAt a few ms and restarts the effect, which used to forget
  // the tick it had just played and play the same second twice.
  const lastTick = useRef<{ checkId: string | null; second: number }>({ checkId: null, second: -1 });
  const tickCheckId = rc.check?.id ?? null;
  useEffect(() => {
    if (mode === "idle") {
      document.title = baseTitle(document.title);
      setFaviconDot(null);
      return;
    }
    let flash = false;
    const run = () => {
      const now = Date.now();
      if (mode === "searching" && since) {
        document.title = titleFor({ kind: "searching", since }, document.title, now);
        return;
      }
      flash = !flash;
      document.title = titleFor({ kind: "found", flash }, document.title, now);
      const left = Math.ceil((deadlineAt - now) / 1000);
      // One tick per second for the whole accept window (lib/queue-sounds skips a
      // tick while another queue sound is still playing, so nothing overlaps).
      const seen = lastTick.current;
      // Only ever count down: a new match, or a lower second than the last tick.
      if (left > 0 && (seen.checkId !== tickCheckId || left < seen.second)) {
        lastTick.current = { checkId: tickCheckId, second: left };
        playQueueSound("tick");
      }
    };
    run();
    setFaviconDot(mode === "found" ? "#ff5500" : "#2ecc71");
    const id = window.setInterval(run, mode === "found" ? 500 : 1000);
    return () => {
      window.clearInterval(id);
      document.title = baseTitle(document.title);
      setFaviconDot(null);
    };
  }, [mode, since, deadlineAt, tickCheckId]);

  return null;
}
