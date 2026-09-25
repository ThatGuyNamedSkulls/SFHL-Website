/**
 * The five player cards on an upcoming season's Overview (docs/LEAGUE_V2_PLAN.md
 * C1): the viewer's team's main roster with the viewer always in the middle.
 * A sub still sits in the middle, next to the team's top 4 starters by Elo.
 */
import { client } from "@/lib/db";
import { getRankForElo } from "@/data/ranks";
import { seasonEntries, type TeamBadge } from "@/lib/league";
import { listTeams, type Team } from "@/lib/teams";
import type { RankTierLetter } from "@/types";

export interface LineupCard {
  name: string;
  avatar: string | null;
  country: string | null;
  /** Main Elo; null while unranked (placements not done). */
  elo: number | null;
  rank: RankTierLetter;
  captain: boolean;
  me: boolean;
  sub: boolean;
}

export interface Lineup {
  team: TeamBadge;
  signedUp: boolean;
  /** Always 5 slots; null = an empty starter spot. Index 2 is the viewer. */
  cards: (LineupCard | null)[];
}

/** Where the others go around the middle card: closest first (by Elo, highest first). */
const AROUND = [1, 3, 0, 4];

/**
 * Pure: arrange `me` in the middle and up to 4 teammates around them.
 * `starters` may include `me`; they're sorted by Elo, highest nearest the middle.
 */
export function arrangeLineup<T extends { key: string; elo: number | null }>(me: T, starters: T[]): (T | null)[] {
  const others = starters
    .filter((p) => p.key !== me.key)
    .sort((a, b) => (b.elo ?? -1) - (a.elo ?? -1))
    .slice(0, 4);
  const slots: (T | null)[] = [null, null, me, null, null];
  others.forEach((p, i) => {
    slots[AROUND[i]] = p;
  });
  return slots;
}

/** The team the Overview shows for this viewer: signed up this season, else captained, else any. */
function pickTeam(teams: Team[], viewerId: string, signed: Set<string>): Team | null {
  const mine = teams.filter((t) => t.members.some((m) => m.discordId === viewerId && m.status === "accepted"));
  return (
    mine.find((t) => signed.has(t.id)) ??
    mine.find((t) => t.captainId === viewerId) ??
    mine.sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
    null
  );
}

export async function viewerLineup(seasonId: number, viewerId: string): Promise<Lineup | null> {
  const signed = new Set((await seasonEntries(seasonId)).filter((e) => e.status !== "ineligible").map((e) => e.teamId));
  const team = pickTeam(await listTeams(), viewerId, signed);
  if (!team) return null;
  const accepted = team.members.filter((m) => m.status === "accepted");
  const names = accepted.map((m) => m.playerName).filter((n): n is string => !!n);
  const info = new Map<string, Record<string, unknown>>();
  if (names.length) {
    const rs = await client
      .execute({
        sql: `SELECT * FROM players WHERE LOWER(name) IN (${names.map(() => "?").join(",")})`,
        args: names.map((n) => n.toLowerCase()),
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const r of rs.rows as Record<string, unknown>[]) info.set(String(r.name).toLowerCase(), r);
  }
  const card = (m: Team["members"][number]) => {
    const p = m.playerName ? info.get(m.playerName.toLowerCase()) : undefined;
    const placed = p ? Number(p.placement_done ?? 1) === 1 : false;
    const elo = p && placed && Number(p.elo) > 0 ? Number(p.elo) : null;
    return {
      key: m.discordId,
      elo,
      card: {
        name: m.playerName || m.username,
        avatar: (p?.roblox_avatar_image as string | null) ?? m.avatar ?? null,
        country: p?.country ? String(p.country).toLowerCase() : null,
        elo,
        rank: (elo === null ? "UNRANKED" : getRankForElo(elo).letter) as RankTierLetter,
        captain: m.discordId === team.captainId,
        me: m.discordId === viewerId,
        sub: m.role === "sub",
      } satisfies LineupCard,
    };
  };
  const meMember = accepted.find((m) => m.discordId === viewerId);
  if (!meMember) return null;
  const starters = accepted.filter((m) => m.role !== "sub").map(card);
  const slots = arrangeLineup(card(meMember), starters);
  return {
    team: { id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl, accentColor: team.accentColor },
    signedUp: signed.has(team.id),
    cards: slots.map((s) => s?.card ?? null),
  };
}
