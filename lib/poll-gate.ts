"use client";

/**
 * When background polls should run (docs/PERFORMANCE_PLAN.md step 3).
 *
 * - Hidden tab → polls stop (unless they ask to keep going, e.g. the ready
 *   check while you're queued) and run once as soon as the tab is visible again.
 * - No mouse / keyboard / touch / scroll for 2 minutes → polls slow down ×3,
 *   and run once as soon as you're active again.
 *
 * `startPolling` is the plain version (module-level stores); components use
 * `usePolling` from components/use-polling.ts.
 */

export const IDLE_AFTER_MS = 2 * 60_000;
export const IDLE_FACTOR = 3;

let lastActive = Date.now();
let installed = false;
const wakeListeners = new Set<() => void>();

function wake() {
  wakeListeners.forEach((l) => l());
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onActivity = () => {
    const wasIdle = Date.now() - lastActive > IDLE_AFTER_MS;
    lastActive = Date.now();
    if (wasIdle) wake();
  };
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(ev, onActivity, { passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastActive = Date.now();
      wake();
    }
  });
}

export function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function isIdle(): boolean {
  return Date.now() - lastActive > IDLE_AFTER_MS;
}

export interface PollOptions {
  /** Keep polling in a hidden tab (browsers still slow hidden timers down). */
  keepWhenHidden?: boolean;
  /** Slow down ×3 after 2 minutes without activity (default true). */
  idleSlowdown?: boolean;
  /** Run once right away (default true). */
  immediate?: boolean;
}

/** Run `fn` every `baseMs` under the gate's rules. Returns stop(). */
export function startPolling(fn: () => unknown, baseMs: number, opts: PollOptions = {}): () => void {
  install();
  const { keepWhenHidden = false, idleSlowdown = true, immediate = true } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const run = () => {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => undefined);
    } catch {
      /* a failed poll just waits for the next one */
    }
  };
  const schedule = () => {
    if (stopped) return;
    // Hidden: stop here; the visibility wake-up starts it again.
    if (!keepWhenHidden && isHidden()) return;
    const delay = idleSlowdown && isIdle() ? baseMs * IDLE_FACTOR : baseMs;
    timer = setTimeout(() => {
      timer = null;
      if (!keepWhenHidden && isHidden()) return;
      run();
      schedule();
    }, delay);
  };
  const onWake = () => {
    if (stopped) return;
    // Back from hidden or idle: refresh now, then continue at the normal pace.
    if (timer) clearTimeout(timer);
    timer = null;
    run();
    schedule();
  };
  wakeListeners.add(onWake);
  if (immediate && !(isHidden() && !keepWhenHidden)) run();
  schedule();
  return () => {
    stopped = true;
    wakeListeners.delete(onWake);
    if (timer) clearTimeout(timer);
  };
}
