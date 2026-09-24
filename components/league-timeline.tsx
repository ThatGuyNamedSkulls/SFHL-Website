"use client";

/**
 * "Season progress" (ESEA-style): three milestones in a strip — the last one
 * done and the next ones — with "View all" opening the whole timeline.
 * Times are shown in the viewer's own time zone.
 */
import { useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import type { Milestone } from "@/lib/league-timeline";

function fmt(ts: number) {
  return new Date(ts)
    .toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })
    .toUpperCase();
}

function Item({ m, compact }: { m: Milestone; compact?: boolean }) {
  return (
    <div className={`flex items-start gap-3 ${compact ? "" : "py-3"}`}>
      {m.done ? (
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#ff5500] text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : (
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-white/60" />
      )}
      <div className="min-w-0">
        <div className="text-[10px] font-semibold tracking-[0.08em] text-white/55" suppressHydrationWarning>
          {m.at ? fmt(m.at) : "TO BE ANNOUNCED"}
        </div>
        <div className="text-sm font-black text-white">{m.label}</div>
      </div>
    </div>
  );
}

export function LeagueTimeline({ strip, all }: { strip: Milestone[]; all: Milestone[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-white">Season progress</h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-black uppercase tracking-wide text-[#ff5500] hover:text-white"
        >
          View all
        </button>
      </div>
      <div className="grid gap-4 rounded-xl border border-white/[0.08] bg-[#121212] px-5 py-4 sm:grid-cols-3">
        {strip.map((m) => (
          <Item key={m.key} m={m} compact />
        ))}
      </div>

      {open ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Season progress"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-white/10 bg-[#161616] shadow-2xl"
          >
            <div className="relative border-b border-white/[0.08] px-5 py-4 text-center">
              <h3 className="text-lg font-black text-white">Progress</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="absolute right-4 top-4 text-white/70 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-2">
              {all.map((m) => (
                <Item key={m.key} m={m} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border-t border-white/[0.08] py-3 text-sm font-black uppercase tracking-wide text-white/85 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
