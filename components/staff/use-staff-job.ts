"use client";

/**
 * Send one staff action to the bot and wait for its answer (lib/staff-jobs.ts).
 * Asks every second. If the bot hasn't picked the action up after 30 s, the
 * action is cancelled so it can't run later by surprise.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffJob, StaffJobStatus } from "@/lib/staff-jobs";

const POLL_MS = 1_000;
/** The bot hasn't started it by then: cancel. */
const PICKUP_MS = 30_000;
/** Started but still going by then: stop watching (Recent actions shows the end). */
const GIVE_UP_MS = 120_000;

export type StaffJobState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "waiting"; job: StaffJob }
  | { phase: "finished"; job: StaffJob }
  | { phase: "error"; message: string };

const FINAL: StaffJobStatus[] = ["done", "failed", "cancelled"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJob(url: string, init?: RequestInit): Promise<StaffJob | null> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const json = (await res.json().catch(() => null)) as { job?: StaffJob } | null;
    return json?.job ?? null;
  } catch {
    return null;
  }
}

export function useStaffJob(onSettled?: (job: StaffJob) => void) {
  const [state, setState] = useState<StaffJobState>({ phase: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    async (kind: string, args: Record<string, unknown>): Promise<StaffJob | null> => {
      setState({ phase: "sending" });
      let job: StaffJob;
      try {
        const res = await fetch("/api/staff/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, args }),
        });
        const json = (await res.json().catch(() => ({}))) as { job?: StaffJob; error?: string };
        if (!res.ok || !json.job) {
          setState({ phase: "error", message: json.error || "Couldn't send that to the bot." });
          return null;
        }
        job = json.job;
      } catch {
        setState({ phase: "error", message: "Couldn't reach the website. Check your connection." });
        return null;
      }

      setState({ phase: "waiting", job });
      const started = Date.now();
      while (alive.current && !FINAL.includes(job.status)) {
        await sleep(POLL_MS);
        job = (await readJob(`/api/staff/jobs/${job.id}`)) ?? job;
        const waited = Date.now() - started;
        if (job.status === "pending" && waited > PICKUP_MS) {
          job = (await readJob(`/api/staff/jobs/${job.id}`, { method: "DELETE" })) ?? job;
        } else if (job.status === "running" && waited > GIVE_UP_MS) {
          if (alive.current) {
            setState({
              phase: "error",
              message: "The bot is still working on it. Check Recent actions in a minute.",
            });
          }
          onSettled?.(job);
          return job;
        }
        if (alive.current && !FINAL.includes(job.status)) setState({ phase: "waiting", job });
      }
      if (!alive.current) return job;
      setState({ phase: "finished", job });
      onSettled?.(job);
      return job;
    },
    [onSettled]
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, run, reset, busy: state.phase === "sending" || state.phase === "waiting" };
}
