/**
 * Season progress (the ESEA-style "Season progress" strip + "View all" list):
 * the season's milestones, planned from its dates and replaced by what really
 * happened (league_events) once it has. Pure — the page passes everything in.
 */
import { defaultSlot, weekWindow, type Season } from "@/lib/league";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface Milestone {
  key: string;
  label: string;
  /** When it happened (done) or is planned; null = not known yet. */
  at: number | null;
  done: boolean;
}

/** Earliest time each event kind happened, e.g. { signups_opened: 1790000000000 }. */
export type EventTimes = Partial<Record<string, number>>;

export function seasonTimeline(season: Season, events: EventTimes, now = Date.now()): Milestone[] {
  const start = season.startDate;
  const weeks = season.weeks;
  const cancelled = season.status === "cancelled";
  // Scheduled milestones (registration close, season start) show their planned date;
  // staff actions (divisions drawn, playoffs started, season end) show when they happened.
  const m = (
    key: string,
    label: string,
    planned: number | null,
    eventKind?: string,
    prefer: "event" | "plan" = "event"
  ): Milestone => {
    const happened = eventKind ? events[eventKind] : undefined;
    const at = prefer === "plan" ? planned ?? happened : happened ?? planned;
    return { key, label, at: at ?? null, done: happened !== undefined || (at !== null && at !== undefined && at <= now) };
  };
  const list: Milestone[] = [
    m("signups_open", "Registration Open", null, "signups_opened"),
    m("signups_close", "Registration Close", season.signupClose, "divisions_drawn", "plan"),
    m("divisions", "Divisions Drawn", null, "divisions_drawn"),
    // Done when week 1 begins, not when staff pressed Start (that can be days earlier).
    m("season_start", "Season Start", start),
  ];
  if (start) {
    list.push(m("first_default", "First Default Day", defaultSlot(start, 1)));
    list.push(m("regular_end", "Regular Season Ends", weekWindow(start, weeks).end + 1));
    list.push(m("playoffs_start", "Playoffs Begin", start + weeks * WEEK, "playoffs_started"));
    list.push(m("season_end", "Season End", start + (weeks + 2) * WEEK, "season_finished"));
  } else {
    list.push(m("playoffs_start", "Playoffs Begin", null, "playoffs_started"));
    list.push(m("season_end", "Season End", null, "season_finished"));
  }
  if (cancelled) list.push({ key: "cancelled", label: "Season Cancelled", at: events.season_cancelled ?? null, done: true });
  // A step that happened implies every earlier step did.
  let lastDone = -1;
  list.forEach((x, i) => {
    if (x.done) lastDone = i;
  });
  return list.map((x, i) => (i < lastDone ? { ...x, done: true } : x));
}

/** The strip on the overview: the last finished milestone and the next two. */
export function timelineWindow(list: Milestone[], size = 3): Milestone[] {
  const firstOpen = list.findIndex((x) => !x.done);
  if (firstOpen === -1) return list.slice(-size);
  const from = Math.max(0, Math.min(firstOpen - 1, list.length - size));
  return list.slice(from, from + size);
}
