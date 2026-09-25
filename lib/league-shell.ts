/**
 * What every league page shows around its content (docs/LEAGUE_UI_PLAN.md
 * step 2): the season switcher (live · upcoming · ⋮ past seasons), the tabs
 * for this season, and the hero's facts. Server-side only.
 */
import {
  LIVE_STATUSES,
  PRIZES,
  UPCOMING_STATUSES,
  listSeasons,
  seasonDivisions,
  seasonEntries,
  type Season,
  type SeasonStatus,
} from "@/lib/league";
import { findCount } from "@/lib/league-find";

export type SeasonBadge = "live" | "upcoming" | null;

export interface SeasonLink {
  id: number;
  name: string;
  status: SeasonStatus;
  badge: SeasonBadge;
}

export interface LeagueTab {
  key: string;
  label: string;
  href: string;
  count?: number;
}

export const STATUS_HEADLINE: Record<SeasonStatus, string> = {
  draft: "Upcoming",
  signup: "Registration open",
  drawn: "Starting soon",
  regular: "Ongoing",
  playoffs: "Playoffs",
  finished: "Finished",
  cancelled: "Cancelled",
};

export function badgeFor(status: SeasonStatus): SeasonBadge {
  if (LIVE_STATUSES.includes(status)) return "live";
  if (UPCOMING_STATUSES.includes(status)) return "upcoming";
  return null;
}

/** The season /league opens on: the live one, else the upcoming one, else the newest. */
export async function defaultSeasonId(): Promise<number | null> {
  const seasons = await listSeasons();
  const pick =
    seasons.find((s) => LIVE_STATUSES.includes(s.status)) ??
    seasons.find((s) => UPCOMING_STATUSES.includes(s.status)) ??
    seasons[0];
  return pick?.id ?? null;
}

/** "Season 4" → "4"; anything else → null (the hero then shows the name instead). */
export function seasonNumber(name: string): string | null {
  const m = /(\d+)\s*$/.exec(name.trim());
  return m ? m[1] : null;
}

export interface LeagueShell {
  season: Season;
  /** Shown as chips in the bar: live + upcoming (or this season when it's neither). */
  pinned: SeasonLink[];
  /** Everything else, newest first, in the ⋮ menu. */
  past: SeasonLink[];
  tabs: LeagueTab[];
  facts: { teams: number; divisions: number; prizePerPlayer: number };
}

export async function leagueShell(seasonId: number): Promise<LeagueShell | null> {
  const seasons = await listSeasons();
  const season = seasons.find((s) => s.id === seasonId);
  if (!season) return null;
  const link = (s: Season): SeasonLink => ({ id: s.id, name: s.name, status: s.status, badge: badgeFor(s.status) });
  const live = seasons.find((s) => LIVE_STATUSES.includes(s.status));
  const upcoming = seasons.find((s) => UPCOMING_STATUSES.includes(s.status));
  const pinnedSeasons = [live, upcoming].filter((s): s is Season => !!s);
  if (!pinnedSeasons.some((s) => s.id === season.id)) pinnedSeasons.unshift(season);
  const pinnedIds = new Set(pinnedSeasons.map((s) => s.id));

  const played = !UPCOMING_STATUSES.includes(season.status);
  // In parallel: each is a round trip to the database.
  const [entries, divisions, finds] = await Promise.all([
    seasonEntries(season.id),
    seasonDivisions(season.id),
    played ? Promise.resolve(0) : findCount(season.id),
  ]);
  const teams = entries.filter((e) => e.status !== "ineligible").length;
  const base = `/league/${season.id}`;
  // Tabs appear as each page is built (docs/LEAGUE_UI_PLAN.md steps 3–8).
  const tabs: LeagueTab[] = [
    { key: "overview", label: "Overview", href: base },
    ...(played ? [] : [{ key: "find", label: "Find Teammates", href: `${base}/find`, count: finds }]),
    ...(played ? [{ key: "standings", label: "Standings", href: `${base}/standings` }] : []),
    // Every entry, like the tab's "All" filter (not-placed teams included).
    { key: "teams", label: "Teams", href: `${base}/teams`, count: entries.length },
    ...(played ? [{ key: "stats", label: "Stats", href: `${base}/stats` }] : []),
    { key: "rules", label: "Rules", href: `${base}/rules` },
  ];
  return {
    season,
    pinned: pinnedSeasons.map(link),
    past: seasons.filter((s) => !pinnedIds.has(s.id)).map(link),
    tabs,
    facts: {
      teams,
      divisions: divisions.length,
      prizePerPlayer: PRIZES[0],
    },
  };
}
