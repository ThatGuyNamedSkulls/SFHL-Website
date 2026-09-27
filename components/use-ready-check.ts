"use client";

/**
 * One shared ready-check + queue-status store for the whole site
 * (docs/QUEUE_UI_PLAN.md §5, useReadyCheck). The global attention watcher
 * (components/queue-attention.tsx) owns the polling; the match-found modal and
 * the Play page's inline panel just read it — one request instead of three.
 */
import { useSyncExternalStore } from "react";
import { playQueueSound } from "@/lib/queue-sounds";

export interface ReadyCheck {
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

export interface ReadyCheckState {
  /** False until the first answer arrives. */
  loaded: boolean;
  check: ReadyCheck | null;
  /** When the check's 20 s window closes (local clock). */
  deadlineAt: number;
  queued: boolean;
  /** When you joined the queue (ms), for the search timer. */
  queuedSince: number | null;
  accepting: boolean;
  error: string | null;
}

let state: ReadyCheckState = {
  loaded: false,
  check: null,
  deadlineAt: 0,
  queued: false,
  queuedSince: null,
  accepting: false,
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<ReadyCheckState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function apply(check: ReadyCheck | null, extra: Partial<ReadyCheckState> = {}) {
  set({ ...extra, check, deadlineAt: check ? Date.now() + check.remainingMs : 0, loaded: true });
}

export async function refreshReadyCheck(): Promise<void> {
  try {
    const res = await fetch("/api/ready-check", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { check?: ReadyCheck | null; queued?: boolean; queuedSince?: number | null };
    apply(data.check ?? null, {
      queued: data.queued === true,
      queuedSince: typeof data.queuedSince === "number" ? data.queuedSince : null,
    });
  } catch {
    /* next poll retries */
  }
}

/** Accept the match on screen. */
export async function acceptReadyCheck(): Promise<void> {
  const check = state.check;
  if (!check || state.accepting) return;
  set({ accepting: true, error: null });
  try {
    const res = await fetch("/api/ready-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: check.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) set({ error: data.error || "Could not accept." });
    else {
      playQueueSound("accepted");
      if (data.check) apply(data.check);
    }
  } catch {
    set({ error: "Could not accept." });
  } finally {
    set({ accepting: false });
  }
}

/** Forget the current check (e.g. after logging out). */
export function resetReadyCheck() {
  state = { loaded: false, check: null, deadlineAt: 0, queued: false, queuedSince: null, accepting: false, error: null };
  listeners.forEach((l) => l());
}

export function useReadyCheck(): ReadyCheckState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}
