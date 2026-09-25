"use client";

/**
 * "Your queue state may have changed" — fired after joining/leaving the queue
 * on the website, or when the queue pill sees you queued (e.g. from Discord),
 * so the ready-check popup refreshes at once instead of at its slow pace.
 */
export const QUEUE_EVENT = "hl-queue-changed";

export function signalQueueChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT));
}
