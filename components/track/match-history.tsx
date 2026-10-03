"use client";

import { useEffect, useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MatchRow, MatchTableHeader } from "@/components/profile/match-row";
import { formatSigned } from "@/lib/match-stats";
import { dayLabel } from "@/lib/profile-stats";
import { sessionsByDay } from "@/lib/track-stats";
import type { Match } from "@/types";

const PAGE = 50;

/** A day to open at (a click in Sessions); `n` changes on every click. */
export interface DayFocus {
  key: string;
  n: number;
}

/**
 * Match history (§4.10, Q4): the profile's match rows for the range, under
 * day headers, 50 at a time.
 */
export function TrackMatchHistory({ matches, now, focus }: { matches: Match[]; now: number; focus: DayFocus | null }) {
  const [shown, setShown] = useState(PAGE);
  const days = useMemo(() => sessionsByDay(matches), [matches]);

  // Show at least up to the end of the day being opened.
  const visible = useMemo(() => {
    let need = shown;
    if (focus) {
      let count = 0;
      for (const d of days) {
        count += d.matches.length;
        if (d.key === focus.key) {
          need = Math.max(need, count);
          break;
        }
      }
    }
    return need;
  }, [shown, focus, days]);

  // The days on screen and their rows, up to `visible` matches.
  const pages = useMemo(() => {
    const out: { day: (typeof days)[number]; rows: Match[] }[] = [];
    let left = visible;
    for (const day of days) {
      if (left <= 0) break;
      const rows = day.matches.slice(0, left);
      left -= rows.length;
      out.push({ day, rows });
    }
    return out;
  }, [days, visible]);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`track-day-${focus.key}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus]);

  if (matches.length === 0) {
    return (
      <div className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
        <EmptyState icon={ListChecks} title="No matches in this range" hint="Try a longer range or another map." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
        <MatchTableHeader />
        {pages.map(({ day: d, rows }) => {
          return (
            <div key={d.key} id={`track-day-${d.key}`} className="scroll-mt-16">
              <div
                className={`flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-2 text-xs text-[#8a8a8a] first:border-t-0 ${
                  focus?.key === d.key ? "bg-[#ff5500]/10" : "bg-[#191919]"
                }`}
              >
                <b className="text-[0.6875rem] uppercase tracking-[0.08em] text-white">{dayLabel(d.endMs, now)}</b>
                <span className="tabular-nums">
                  {d.matches.length} {d.matches.length === 1 ? "match" : "matches"} ·{" "}
                  <span className={d.totals.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>
                    {formatSigned(d.totals.eloChange)} Elo
                  </span>
                </span>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {rows.map((m) => (
                  <MatchRow key={m.id} match={m} timeOnly />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {visible < matches.length ? (
        <button
          type="button"
          onClick={() => setShown(visible + PAGE)}
          className="flex h-10 w-full items-center justify-center rounded-[0.625rem] border border-white/[0.08] bg-[#1c1c1c] text-[0.8125rem] font-bold text-[#c8c8c8] hover:border-white/20 hover:text-white"
        >
          Show more · {Math.min(visible, matches.length)} of {matches.length}
        </button>
      ) : null}
    </div>
  );
}
