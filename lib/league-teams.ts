/**
 * Teams tab (docs/LEAGUE_UI_PLAN.md step 5): every team entered in a season
 * with its country, league status (access), division and entry status.
 * Server-side only.
 */
import { listTeams } from "@/lib/teams";
import {
  accessLabel,
  seasonDivisions,
  seasonEntries,
  teamAccessMap,
  teamCountries,
  type EntryStatus,
  type TeamBadge,
} from "@/lib/league";

export type TeamsFilter = "all" | EntryStatus;

export const STATUS_LABEL: Record<EntryStatus, string> = {
  active: "Confirmed",
  signed_up: "Signed up",
  ineligible: "Not placed",
};

export interface LeagueTeamRow {
  team: TeamBadge;
  country: string | null;
  /** "Main Access", or the Open band from the team's seed Elo ("Open 5-7 Access"). */
  access: string;
  /** True when Match Staff gave the team a named division. */
  inviteOnly: boolean;
  division: { id: number; name: string; tier: number } | null;
  status: EntryStatus;
  /** Why the team wasn't placed (ineligible entries). */
  note: string | null;
  players: string[];
  seedElo: number | null;
  finalPlace: number | null;
  mine: boolean;
  /** The viewer captains this team (they can withdraw it). */
  captain: boolean;
}

/** Status order in the table and the filter chips. */
const STATUS_ORDER: EntryStatus[] = ["active", "signed_up", "ineligible"];

export function parseTeamsFilter(raw: unknown): TeamsFilter {
  return typeof raw === "string" && (STATUS_ORDER as string[]).includes(raw) ? (raw as EntryStatus) : "all";
}

/**
 * Rows in table order: by division (top tier first), then final place, then
 * name; teams without a division after, confirmed before signed up before not placed.
 */
export function sortTeamRows(rows: LeagueTeamRow[]): LeagueTeamRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.division?.tier ?? Infinity) - (b.division?.tier ?? Infinity) ||
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      (a.finalPlace ?? Infinity) - (b.finalPlace ?? Infinity) ||
      a.team.name.localeCompare(b.team.name)
  );
}

/** How many rows each status chip matches (plus "all"). */
export function statusCounts(rows: LeagueTeamRow[]): Record<TeamsFilter, number> {
  const out: Record<TeamsFilter, number> = { all: rows.length, active: 0, signed_up: 0, ineligible: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

export async function leagueTeams(seasonId: number, viewerId: string | null): Promise<LeagueTeamRow[]> {
  const [entries, divisions, teams] = [
    await seasonEntries(seasonId),
    await seasonDivisions(seasonId),
    await listTeams(),
  ];
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const divById = new Map(divisions.map((d) => [d.id, d]));
  const access = await teamAccessMap(entries.map((e) => e.teamId));
  const players = new Map(entries.map((e) => [e.teamId, e.roster.map((p) => p.playerName || p.username)]));
  const countries = await teamCountries(players);

  return sortTeamRows(
    entries.map((e) => {
      const t = teamById.get(e.teamId);
      const code = access.get(e.teamId) ?? null;
      const d = e.divisionId ? divById.get(e.divisionId) : undefined;
      return {
        team: {
          id: e.teamId,
          name: t?.name ?? e.teamName,
          tag: t?.tag ?? e.teamTag,
          logoUrl: t?.logoUrl ?? null,
          accentColor: t?.accentColor ?? "#ff5500",
        },
        country: countries.get(e.teamId) ?? null,
        access: accessLabel(code, e.seedElo),
        inviteOnly: code !== null,
        division: d ? { id: d.id, name: d.name, tier: d.tier } : null,
        status: e.status,
        note: e.note,
        players: players.get(e.teamId) ?? [],
        seedElo: e.seedElo,
        finalPlace: e.finalPlace ?? null,
        mine: !!viewerId && e.roster.some((p) => p.discordId === viewerId),
        captain: !!viewerId && (t?.captainId ?? e.captainId) === viewerId,
      };
    })
  );
}
