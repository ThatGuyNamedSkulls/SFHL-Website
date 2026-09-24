"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

const FORMATS = {
  dateTime: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  date: { day: "numeric", month: "short", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/**
 * A time in the viewer's own time zone. Server pages can't know it, so the
 * server (and the first client render) show `fallback`, then the browser fills it in.
 */
export function LocalTime({
  ts,
  format = "dateTime",
  fallback = "",
}: {
  ts: number;
  format?: keyof typeof FORMATS;
  fallback?: string;
}) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  return <>{client ? new Date(ts).toLocaleString(undefined, FORMATS[format]) : fallback}</>;
}
