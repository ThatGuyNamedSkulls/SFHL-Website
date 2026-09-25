"use client";

import { useEffect, useRef } from "react";
import { startPolling, type PollOptions } from "@/lib/poll-gate";

/**
 * Poll `fn` every `ms` — paused in hidden tabs, ×3 slower after 2 minutes idle,
 * refreshed at once when you come back (lib/poll-gate.ts). `ms` null = off.
 * The latest `fn` is always used, so it needn't be memoized. A new `restartKey`
 * (e.g. the region) polls again at once.
 */
export function usePolling(
  fn: () => unknown,
  ms: number | null,
  opts: PollOptions & { restartKey?: string | number | null } = {}
) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  const { keepWhenHidden, idleSlowdown, immediate, restartKey } = opts;
  useEffect(() => {
    if (ms === null) return;
    return startPolling(() => latest.current(), ms, { keepWhenHidden, idleSlowdown, immediate });
  }, [ms, keepWhenHidden, idleSlowdown, immediate, restartKey]);
}
