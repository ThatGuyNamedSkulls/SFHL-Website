"use client";

import { useMemo } from "react";

interface ActivityHeatmapProps {
  /** Match dates as strings (any format Date can parse, e.g. "2026-06-30"). */
  dates: string[];
  /** Number of days to show (default 91 = 13 weeks). */
  days?: number;
}

/** Local YYYY-MM-DD — avoids the UTC/DST collisions that toISOString() causes. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function level(count: number): string {
  if (count <= 0) return "heat-cell";
  if (count === 1) return "heat-cell heat-1";
  if (count === 2) return "heat-cell heat-2";
  if (count <= 4) return "heat-cell heat-3";
  return "heat-cell heat-4";
}

/**
 * GitHub-style activity grid (magenta/pink) showing match activity by day.
 * Columns are weeks, rows are days of the week.
 */
export function ActivityHeatmap({ dates, days = 91 }: ActivityHeatmapProps) {
  const { weeks, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of dates) {
      const parsed = new Date(d);
      if (Number.isNaN(parsed.getTime())) continue;
      const key = ymd(parsed);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start `days` back, then snap to the beginning of that week (Sunday).
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    start.setDate(start.getDate() - start.getDay());

    const cells: { key: string; count: number }[] = [];
    const cursor = new Date(start);
    // Iterate at local noon so daylight-saving transitions never make two
    // consecutive iterations resolve to the same calendar day.
    cursor.setHours(12, 0, 0, 0);
    const end = new Date(today);
    end.setHours(12, 0, 0, 0);
    let total = 0;
    while (cursor <= end) {
      const key = ymd(cursor);
      const c = counts.get(key) ?? 0;
      total += c;
      cells.push({ key, count: c });
      cursor.setDate(cursor.getDate() + 1);
    }

    const weeks: { key: string; count: number }[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, total };
  }, [dates, days]);

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell) => (
              <div
                key={cell.key}
                className={level(cell.count)}
                title={`${cell.key}: ${cell.count} match${cell.count === 1 ? "" : "es"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-hl-muted">
        <span>{total} matches in the last {days} days</span>
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
