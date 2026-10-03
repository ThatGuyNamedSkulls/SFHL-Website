"use client";

import { formatSigned, ratingColor } from "@/lib/match-stats";
import { dayLabel, formatMatchWhen } from "@/lib/profile-stats";
import type { DaySession } from "@/lib/track-stats";

/** Days listed; older ones are in Match history. */
const MAX_SESSIONS = 7;

const hhmm = (ms: number) => formatMatchWhen(new Date(ms).toISOString()).time;

/**
 * Sessions (§4.8): the range's matches by calendar day in the viewer's time
 * zone (Q5). A day opens Match history at that day.
 */
export function Sessions({
  sessions,
  now,
  onOpenDay,
}: {
  sessions: DaySession[];
  now: number;
  onOpenDay: (key: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.08] px-[1.125rem] pb-3 pt-4">
        <h2 className="text-base font-extrabold text-white">Sessions</h2>
        <span className="text-xs text-[#8a8a8a]">
          by day · your time zone
          {sessions.length > MAX_SESSIONS ? ` · newest ${MAX_SESSIONS} of ${sessions.length}` : ""}
        </span>
      </div>
      {sessions.length === 0 ? (
        <p className="px-[1.125rem] py-4 text-sm text-[#8a8a8a]">No matches in this range.</p>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {sessions.slice(0, MAX_SESSIONS).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onOpenDay(s.key)}
              className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_2.75rem_2.875rem] items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-white/[0.03] md:grid-cols-[6rem_minmax(0,1fr)_4.375rem_4rem_3.75rem] md:gap-3 md:px-[1.125rem] md:py-[0.6875rem]"
              title="Open these matches in Match history"
            >
              <span className="min-w-0">
                <b className="block whitespace-nowrap font-bold text-white">{dayLabel(s.endMs, now)}</b>
                <small className="block text-xs tabular-nums text-[#8a8a8a]">
                  {hhmm(s.startMs)}–{hhmm(s.endMs)}
                </small>
              </span>
              <span className="flex flex-wrap gap-[3px]" aria-label={`${s.totals.wins} wins, ${s.totals.losses} losses`}>
                {[...s.matches].reverse().map((m) => (
                  <i key={m.id} className={`h-3 w-3 rounded-[3px] ${m.result === "W" ? "bg-[#2ecc71]/85" : "bg-[#e74c3c]/85"}`} />
                ))}
              </span>
              <span className="text-right font-bold tabular-nums">
                <span className="text-[#2ecc71]">{s.totals.wins}</span>
                <span className="text-[#6a6a6a]">–</span>
                <span className="text-[#e74c3c]">{s.totals.losses}</span>
              </span>
              <span className={`text-right font-extrabold tabular-nums ${s.totals.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
                {formatSigned(s.totals.eloChange)}
              </span>
              <span className="hidden text-right md:block">
                <i
                  className="inline-block min-w-[2.75rem] rounded-[5px] px-1.5 py-[3px] text-center text-xs font-extrabold not-italic tabular-nums"
                  style={{
                    color: ratingColor(s.totals.rating),
                    backgroundColor: `color-mix(in srgb, ${ratingColor(s.totals.rating)} 17%, transparent)`,
                    boxShadow: `inset 0 -2px 0 ${ratingColor(s.totals.rating)}`,
                  }}
                >
                  {s.totals.rating.toFixed(2)}
                </i>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
