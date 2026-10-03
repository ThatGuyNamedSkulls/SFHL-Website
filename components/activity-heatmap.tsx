"use client";

import { useMemo } from "react";
import { localDayKey, parseDbTime } from "@/lib/profile-stats";

interface ActivityHeatmapProps {
  /** Match times: database UTC strings ("2026-06-30 19:41:00") or ISO. */
  dates: string[];
  /** Number of days to show (default 91 = 13 weeks). */
  days?: number;
}

function level(count: number): string {
  if (count <= 0) return "heat-cell";
  if (count === 1) return "heat-cell heat-1";
  if (count === 2) return "heat-cell heat-2";
  if (count <= 4) return "heat-cell heat-3";
  return "heat-cell heat-4";
}

/** Width of one week column (cell + gap), for placing the month labels. */
const COLUMN_PX = 15;

/**
 * GitHub-style activity grid (magenta/pink) showing match activity by day, in
 * the viewer's calendar. Columns are weeks (Sunday first), rows are days.
 */
export function ActivityHeatmap({ dates, days = 91 }: ActivityHeatmapProps) {
  const { weeks, total, months } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of dates) {
      const ms = parseDbTime(d);
      if (ms == null) continue;
      const key = localDayKey(ms);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Start `days` back, then snap to the beginning of that week (Sunday).
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    start.setDate(start.getDate() - start.getDay());

    const cells: { key: string; count: number; label: string }[] = [];
    const months: { col: number; label: string }[] = [];
    // Iterate at local noon so daylight-saving transitions never make two
    // consecutive iterations resolve to the same calendar day.
    const cursor = new Date(start);
    cursor.setHours(12, 0, 0, 0);
    let total = 0;
    while (cursor <= today) {
      const key = localDayKey(cursor.getTime());
      const c = counts.get(key) ?? 0;
      total += c;
      // A month's label sits over the week holding its first Sunday.
      if (cursor.getDay() === 0 && cursor.getDate() <= 7) {
        months.push({
          col: Math.floor(cells.length / 7),
          label: cursor.toLocaleDateString("en-GB", { month: "short" }),
        });
      }
      cells.push({
        key,
        count: c,
        label: cursor.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const weeks: { key: string; count: number; label: string }[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, total, months };
  }, [dates, days]);

  return (
    <div>
      <div className="flex gap-1.5">
        <div className="grid grid-rows-[repeat(7,12px)] gap-[3px] pt-4 text-[0.5625rem] leading-[12px] text-hl-muted" aria-hidden>
          <span />
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
        </div>
        <div className="min-w-0 overflow-x-auto pb-1">
          <div className="relative h-3.5 text-[0.625rem] text-hl-muted" aria-hidden>
            {months.map((m) => (
              <span key={`${m.col}-${m.label}`} className="absolute top-0" style={{ left: m.col * COLUMN_PX }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="mt-0.5 flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((cell) => (
                  <div
                    key={cell.key}
                    className={level(cell.count)}
                    title={`${cell.label}: ${cell.count} match${cell.count === 1 ? "" : "es"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 text-[0.6875rem] text-hl-muted">
        <span>
          <b className="text-white tabular-nums">{total}</b> {total === 1 ? "match" : "matches"}
        </span>
        <span className="flex items-center gap-1">
          Less
          <span className="heat-cell" />
          <span className="heat-cell heat-1" />
          <span className="heat-cell heat-2" />
          <span className="heat-cell heat-3" />
          <span className="heat-cell heat-4" />
          More
        </span>
      </div>
    </div>
  );
}
