/**
 * Everything the FACEIT-style team page shows (docs/LEAGUE_V2_PLAN.md D4), in
 * one call: the team, its members as player cards (main roster, subs, coach,
 * open invites), its country, titles, league status and seasons, and its
 * league matches with the Stats tab's summary.
 */
import { client } from "@/lib/db";
import { getEquippedVisualsMap } from "@/lib/cosmetics";
import { teamLeagueHistory, teamLeagueStatus } from "@/lib/league";
import { cardFromMember, type PlayerCardData } from "@/lib/player-card";
import { summarizeTeam, teamLeagueMatches } from "@/lib/team-stats";
import { titlesForTeam } from "@/lib/team-titles";
import { getTeam, type Team } from "@/lib/teams";

export interface MemberCard extends PlayerCardData {
  discordId: string;
  playerName: string | null;
  role: Team["members"][number]["role"];
  invited: boolean;
}

export async function teamPageData(teamId: string, viewerId: string | null) {
  const team = await getTeam(teamId);
  if (!team) return null;
  const names = team.members.map((m) => m.playerName).filter((n): n is string => !!n);
  // Everything below is independent: one parallel wave of round trips.
  const [players, art, titles, seasons, status, games] = await Promise.all([
    names.length
      ? client
          .execute({
            sql: `SELECT * FROM players WHERE LOWER(name) IN (${names.map(() => "?").join(",")})`,
            args: names.map((n) => n.toLowerCase()),
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }))
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    getEquippedVisualsMap().catch(() => new Map<string, { card: string | null }>()),
    titlesForTeam(team.id).catch(() => []),
    teamLeagueHistory(team.id).catch(() => []),
    teamLeagueStatus(team).catch(() => null),
    teamLeagueMatches(team.id).catch(() => ({ matches: [], lines: [] })),
  ]);
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of players.rows as Record<string, unknown>[]) rows.set(String(r.name).toLowerCase(), r);
  const members: MemberCard[] = team.members.map((m) => ({
    ...cardFromMember(m, {
      row: m.playerName ? rows.get(m.playerName.toLowerCase()) : undefined,
      tag: team.tag,
      captainId: team.captainId,
      viewerId,
      cardArt: m.playerName ? art.get(m.playerName)?.card ?? null : null,
    }),
    discordId: m.discordId,
    playerName: m.playerName,
    role: m.role,
    invited: m.status === "invited",
  }));
  const byElo = (a: MemberCard, b: MemberCard) => Number(b.captain) - Number(a.captain) || (b.elo ?? -1) - (a.elo ?? -1);
  const accepted = members.filter((m) => !m.invited);

  const counts = new Map<string, number>();
  for (const m of accepted) if (m.country) counts.set(m.country, (counts.get(m.country) ?? 0) + 1);
  let country: string | null = null;
  for (const [c, n] of counts) if (country === null || n > (counts.get(country) ?? 0)) country = c;

  return {
    team,
    country,
    roster: {
      starters: accepted.filter((m) => m.role === "captain" || m.role === "starter").sort(byElo),
      subs: accepted.filter((m) => m.role === "sub").sort(byElo),
      coach: accepted.find((m) => m.role === "coach") ?? null,
      invited: members.filter((m) => m.invited),
    },
    titles,
    seasons,
    status,
    matches: games.matches,
    summary: summarizeTeam(games.matches, games.lines),
  };
}

export type TeamPageData = NonNullable<Awaited<ReturnType<typeof teamPageData>>>;
