/**
 * Pure helpers for the clan pages (docs/CLANS_UI_PLAN.md): tabs and links,
 * the list's sorting and 7-day bars, rules as lines. No database — client
 * components and tests import it.
 */
import { localDayKey, parseDbTime } from "@/lib/profile-stats";

export const CLAN_TABS = ["overview", "members", "leaderboard", "tournaments", "chat", "manage"] as const;
export type ClanTab = (typeof CLAN_TABS)[number];

export function isClanTab(value: string | null | undefined): value is ClanTab {
  return !!value && (CLAN_TABS as readonly string[]).includes(value);
}

/** "/clans/NOVA", "/clans/e113d3e7?tab=members". Ids and tags both work (Q2). */
export function clanHref(idOrTag: string, tab?: ClanTab): string {
  const base = `/clans/${encodeURIComponent(idOrTag.trim())}`;
  return tab && tab !== "overview" ? `${base}?tab=${tab}` : base;
}

export const CLAN_SORTS = ["active", "members", "elo", "new"] as const;
export type ClanSort = (typeof CLAN_SORTS)[number];

export const CLAN_SORT_LABELS: Record<ClanSort, string> = {
  active: "Most active",
  members: "Most members",
  elo: "Highest average Elo",
  new: "Newest",
};

export interface SortableClan {
  name: string;
  memberCount: number;
  createdAt?: number | null;
  stats?: { avgElo: number; week: string[] } | null;
}

/** Most active: matches together this week, then the latest one, then size. */
export function sortClans<T extends SortableClan>(clans: T[], sort: ClanSort): T[] {
  const week = (c: T) => c.stats?.week.length ?? 0;
  const latest = (c: T) => c.stats?.week[0] ?? "";
  const cmp: Record<ClanSort, (a: T, b: T) => number> = {
    active: (a, b) => week(b) - week(a) || (latest(b) > latest(a) ? 1 : latest(b) < latest(a) ? -1 : 0) || b.memberCount - a.memberCount,
    members: (a, b) => b.memberCount - a.memberCount,
    elo: (a, b) => (b.stats?.avgElo ?? 0) - (a.stats?.avgElo ?? 0),
    new: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  };
  return [...clans].sort((a, b) => cmp[sort](a, b) || a.name.localeCompare(b.name));
}

/** Matches together per local day over the last `days` days, oldest → newest. */
export function weekBars(times: string[], now = Date.now(), days = 7): number[] {
  const keys = Array.from({ length: days }, (_, i) => localDayKey(now - (days - 1 - i) * 86_400_000));
  const counts = keys.map(() => 0);
  for (const t of times) {
    const ms = parseDbTime(t);
    if (ms == null) continue;
    const idx = keys.indexOf(localDayKey(ms));
    if (idx >= 0) counts[idx]++;
  }
  return counts;
}

/** The rules text as a list: one rule per line, leading "1." / "-" removed. */
export function rulesLines(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);
}

/** Kills over deaths with two decimals, or null without any matches. */
export function kdOf(kills: number, deaths: number, matches: number): number | null {
  if (!matches) return null;
  return Math.round((deaths > 0 ? kills / deaths : kills) * 100) / 100;
}

/** "just now", "12m ago", "2h ago", "Yesterday", "4d ago", then "12 Sep". */
export function shortAgo(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
