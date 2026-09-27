"use client";

import { Check, Circle } from "lucide-react";
import type { QueueUi } from "@/lib/queue-ui-state";

/** Signed in but can't queue yet: the steps, each with its own status. */
export function SetupChecklist({ ui }: { ui: QueueUi }) {
  if (!ui.steps) return null;
  return (
    <section className="rounded-xl border border-hl-warn/30 bg-hl-warn/[0.05] p-4 md:p-5">
      <h2 className="text-base font-black text-white">{ui.headline}</h2>
      <p className="mt-0.5 text-[13px] text-white/70">{ui.detail}</p>
      <ol className="mt-3 space-y-2">
        {ui.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3">
            {s.done ? (
              <Check className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-hl-green/20 p-0.5 text-hl-green" />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-white/35" />
            )}
            <div>
              <div className={`text-sm font-bold ${s.done ? "text-white/60 line-through" : "text-white"}`}>{s.label}</div>
              {!s.done ? <div className="text-xs text-white/60">{s.hint}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
