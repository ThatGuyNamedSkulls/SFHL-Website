/**
 * Post-queue lobbies: the website's read-only mirror of the private match the
 * bot creates when a queue fills. The bot's queue cog writes a `web_lobbies`
 * row (id = Discord channel id) holding the matched players, their team split,
 * and the channel to link to; here we read the one the current user is in and
 * enrich each member with their avatar + rank for display.
 */

import { client, mapRank } from "@/lib/db";
import { avatarUrl } from "@/lib/format";

/** 3 hours: a match is long over by then, so old lobby rows are ignored/pruned. */
const LOBBY_TTL_MS = 3 * 60 * 60 * 1000;

export interface LobbyMemberView {
  discordId: string;
  name: string;
  team: number;
  avatar: string | null;
  rank: string;
}

export interface LobbyView {
  channelId: string;
  channelName: string;
  guildId: string;
  /** Discord deep link to the match channel. */
  channelUrl: string;
  map: string | null;
  createdAt: number;
  members: LobbyMemberView[];
}

interface RawLobby {
  id: string;
  channelId: string;
  channelName: string;
  guildId: string;
  map: string | null;
  createdAt: number;
  members: { discordId: string; name: string; team: number }[];
}

/** Enrich the raw members with avatar + rank from the players table (one query). */
async function enrich(raw: RawLobby): Promise<LobbyView> {
  const names = raw.members.map((m) => m.name);
  const byName = new Map<string, { avatar: string | null; rank: string }>();
  if (names.length > 0) {
    const placeholders = names.map(() => "?").join(",");
    try {
      const rs = await client.execute({
        sql: `SELECT name, rank, roblox_avatar_image FROM players WHERE name IN (${placeholders})`,
        args: names,
      });
      for (const r of rs.rows as unknown as Record<string, unknown>[]) {
        byName.set(r.name as string, {
          avatar: avatarUrl(r.roblox_avatar_image as string | null) || null,
          rank: mapRank((r.rank as string) || ""),
        });
      }
    } catch {
      /* players table unreadable — fall back to bare names */
    }
  }
  return {
    channelId: raw.channelId,
    channelName: raw.channelName,
    guildId: raw.guildId,
    channelUrl: `https://discord.com/channels/${raw.guildId}/${raw.channelId}`,
    map: raw.map ?? null,
    createdAt: raw.createdAt,
    members: raw.members.map((m) => ({
      discordId: m.discordId,
      name: m.name,
      team: m.team,
      avatar: byName.get(m.name)?.avatar ?? null,
      rank: byName.get(m.name)?.rank ?? "UNRANKED",
    })),
  };
}

/**
 * The active lobby the given Discord user is in, or null. Prunes rows older
 * than the TTL as it scans (best-effort). The bot owns creation; the website
 * only reads and expires.
 */
export async function getLobbyForUser(discordId: string): Promise<LobbyView | null> {
  let rows;
  try {
    const rs = await client.execute("SELECT id, data, created_at FROM web_lobbies");
    rows = rs.rows;
  } catch {
    return null; // table not created yet (no match has ever started)
  }

  const cutoff = Date.now() - LOBBY_TTL_MS;
  const expired: string[] = [];
  let mine: RawLobby | null = null;

  for (const row of rows) {
    const createdAt = Number(row.created_at);
    if (createdAt < cutoff) {
      expired.push(row.id as string);
      continue;
    }
    if (mine) continue;
    try {
      const data = JSON.parse(row.data as string) as RawLobby;
      if (data.members?.some((m) => m.discordId === discordId)) mine = data;
    } catch {
      expired.push(row.id as string);
    }
  }

  if (expired.length > 0) {
    try {
      await client.batch(
        expired.map((id) => ({ sql: "DELETE FROM web_lobbies WHERE id = ?", args: [id] }))
      );
    } catch {
      /* best-effort prune */
    }
  }

  return mine ? enrich(mine) : null;
}
