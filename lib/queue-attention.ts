/**
 * Pure helpers for queue "attention" (docs/QUEUE_UI_PLAN.md §8): the search
 * timer, the tab title while searching / on match found, and which transition
 * sound to play. Tested in tests/queue-attention.test.ts.
 */

/** "0:07", "1:24", "12:05", "1:02:09". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const PREFIX = /^(▶ \d+(?::\d\d)+ · |⚠ MATCH FOUND — )/;

/** The page's own title without anything this module added. */
export function baseTitle(title: string): string {
  return title.replace(PREFIX, "");
}

export type AttentionState =
  | { kind: "idle" }
  | { kind: "searching"; since: number }
  | { kind: "found"; flash: boolean };

/** The tab title for a state (`flash` alternates while a match waits for you). */
export function titleFor(state: AttentionState, title: string, now: number): string {
  const base = baseTitle(title);
  if (state.kind === "searching") return `▶ ${formatElapsed(now - state.since)} · ${base}`;
  if (state.kind === "found") return state.flash ? `⚠ MATCH FOUND — ${base}` : base;
  return base;
}

export type QueueSound = "start" | "end" | "found" | "tick" | "accepted";

/**
 * Which sound a change in queue state should make, or null.
 * `prev` is null on the first answer after the page loads (never a sound then).
 */
export function soundForTransition(
  prev: { queued: boolean; checkId: string | null; checkStatus: string | null } | null,
  next: { queued: boolean; checkId: string | null; checkStatus: string | null }
): QueueSound | null {
  if (!prev) return null;
  if (next.checkStatus === "pending" && next.checkId && next.checkId !== prev.checkId) return "found";
  if (next.checkStatus === "pending" && prev.checkStatus !== "pending" && next.checkId === prev.checkId) return "found";
  if (!prev.queued && next.queued && next.checkStatus !== "pending") return "start";
  // Left the queue with no match starting: cancelled, removed, or the queue closed.
  if (prev.queued && !next.queued && next.checkStatus !== "pending" && next.checkStatus !== "started") return "end";
  return null;
}
