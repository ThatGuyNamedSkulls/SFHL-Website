/**
 * What GET /api/clubs/[id] (and every clan action) sends the clan page
 * (docs/CLANS_UI_PLAN.md §5): the clan as the viewer may see it, every member
 * with rank, Elo, matches together and this season's record, the clan stats
 * and the activity feed. Each action returns this, so the page never needs a
 * second request after a change.
 */
import { getSeasonResets } from "@/lib/db";
import { clubForClient, type Club } from "@/lib/clubs";
import {
  averageElo,
  buildActivity,
  groupTogether,
  memberPlayers,
  playerFor,
  seasonRecords,
  togetherCounts,
  togetherRows,
  type SeasonRecord,
} from "@/lib/clan-stats";
import { tournamentsForClub } from "@/lib/tournaments";

const NO_RECORD: SeasonRecord = { matches: 0, wins: 0, kills: 0, deaths: 0 };

export async function clanPayload(club: Club, viewerId?: string | null) {
  const view = clubForClient(club, viewerId);
  const resets = await getSeasonResets().catch(() => []);
  const seasonStart = resets.length ? resets[resets.length - 1].reset_at : null;
  const seasonNumber = resets.length + 1;

  const players = await memberPlayers([...club.members, ...view.requests]).catch(() => ({
    byId: new Map(),
    byName: new Map(),
  }));
  const memberNames = [
    ...new Set(
      club.members.map((m) => playerFor(players, m)?.name ?? m.playerName).filter((n): n is string => !!n)
    ),
  ];
  const [rows, records, cups] = await Promise.all([
    togetherRows(memberNames, seasonStart).catch(() => []),
    seasonRecords(memberNames, seasonStart).catch(() => new Map<string, SeasonRecord>()),
    tournamentsForClub(club.id).catch(() => []),
  ]);
  const together = groupTogether(rows);
  const counts = togetherCounts(together);

  const members = view.members.map((m) => {
    const p = playerFor(players, m);
    const name = p?.name ?? m.playerName;
    const key = (name || "").toLowerCase();
    return {
      ...m,
      playerName: name || null,
      avatar: m.avatar || p?.avatar || null,
      elo: p?.elo ?? 0,
      rank: p?.rank ?? "UNRANKED",
      placementDone: !!p?.placementDone,
      country: p?.country ?? null,
      together: key ? counts.get(key) ?? 0 : 0,
      season: key ? records.get(key) ?? NO_RECORD : NO_RECORD,
    };
  });
  const average = averageElo(members);
  const memberName = (discordId: string) => {
    const m = club.members.find((x) => x.discordId === discordId);
    return m ? m.playerName || m.username : null;
  };

  return {
    club: {
      ...view,
      members,
      requests: view.requests.map((r) => {
        const p = playerFor(players, r);
        return {
          ...r,
          elo: p?.elo ?? 0,
          rank: p?.rank ?? "UNRANKED",
          placementDone: !!p?.placementDone,
          country: p?.country ?? null,
        };
      }),
      invites: view.invites.map((inv) => ({ ...inv, createdByName: memberName(inv.createdBy) })),
    },
    stats: {
      members: members.length,
      ranked: average.ranked,
      avgElo: average.avg,
      avgRank: average.rank,
      together: together.length,
      togetherWins: together.filter((m) => m.result === "W").length,
    },
    season: { number: seasonNumber, label: `Season ${seasonNumber}`, startedAt: seasonStart },
    activity: buildActivity({
      together: together.slice(0, 20),
      members: club.members.map((m) => ({
        name: m.playerName || m.username,
        joinedAt: Number(m.joinedAt) || 0,
        owner: m.discordId === club.ownerId,
      })),
      createdAt: Number(club.createdAt) || 0,
      ownerName: club.ownerName,
      cups: cups.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        teams: t.teams.length,
        size: t.size,
        createdAt: Number(t.createdAt) || 0,
      })),
    }),
  };
}

export type ClanPayload = Awaited<ReturnType<typeof clanPayload>>;
