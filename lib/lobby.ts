/**
 * Post-queue lobbies: shared matchroom between Discord and the website.
 * The bot writes `web_lobbies` (id = Discord channel id). The site reads it
 * and can apply captain map bans (`veto.actionSource = "website"`), which the
 * bot then reconciles onto the live Discord MapVoteView.
 */

import { client, mapRank, ensurePlayerDiscordColumns } from "@/lib/db";
import { ChatMessage, listLobbyChat } from "@/lib/lobby-chat";
import { pickAvatar, resolveAvatarsByDiscordId } from "@/lib/avatar";

/** 3 hours: a match is long over by then, so old lobby rows are ignored/pruned. */
const LOBBY_TTL_MS = 3 * 60 * 60 * 1000;

export interface LobbyMemberView {
  discordId: string;
  name: string;
  team: number;
  avatar: string | null;
  rank: string;
  elo: number;
  left?: boolean;
  sub?: boolean;
}

export interface VetoHistoryEntry {
  map: string;
  bannedByCaptainId: string;
}

export interface VetoState {
  available: boolean;
  actionSource: string;
  remainingMaps: string[];
  history: VetoHistoryEntry[];
  currentTurnCaptainId: string | null;
  complete: boolean;
  turnDeadlineAt?: number | null;
}

export interface LobbyView {
  channelId: string;
  channelName: string;
  guildId: string;
  /** Discord deep link to the match text channel. */
  channelUrl: string;
  /** Private match voice channel id (players + Match Staff), if created. */
  voiceChannelId: string | null;
  /** Discord deep link to the private match voice channel. */
  voiceChannelUrl: string | null;
  map: string | null;
  selectedMap: string | null;
  status: string;
  side: { name: string; team: number } | null;
  captains: { team1: string | null; team2: string | null };
  veto: VetoState | null;
  createdAt: number;
  members: LobbyMemberView[];
  server: { url: string } | null;
  messages: ChatMessage[];
}

interface RawLobby {
  id?: string;
  channelId: string;
  channelName: string;
  guildId: string;
  voiceChannelId?: string | null;
  voiceChannelName?: string | null;
  map?: string | null;
  selectedMap?: string | null;
  status?: string;
  side?: { name: string; team: number } | null;
  captains?: { team1?: string; team2?: string };
  veto?: Partial<VetoState> | null;
  createdAt: number;
  members: { discordId: string; name: string; team: number; left?: boolean; sub?: boolean }[];
  server?: { url?: string } | null;
}

function discordUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function normalizeVeto(raw: RawLobby): VetoState | null {
  const v = raw.veto;
  if (!v) return null;
  return {
    available: v.available !== false && !v.complete,
    actionSource: v.actionSource || "discord",
    remainingMaps: Array.isArray(v.remainingMaps) ? v.remainingMaps : [],
    history: Array.isArray(v.history) ? v.history : [],
    currentTurnCaptainId: v.currentTurnCaptainId ?? null,
    complete: !!v.complete,
    turnDeadlineAt: typeof v.turnDeadlineAt === "number" ? v.turnDeadlineAt : null,
  };
}

/** Enrich the raw members with avatar, rank, and elo from the players table (one query). */
async function enrich(raw: RawLobby): Promise<LobbyView> {
  const names = raw.members.map((m) => m.name);
  const byName = new Map<string, { avatar: string | null; rank: string; elo: number }>();
  if (names.length > 0) {
    const placeholders = names.map(() => "?").join(",");
    try {
      await ensurePlayerDiscordColumns();
      const rs = await client.execute({
        sql: `SELECT name, rank, elo, roblox_avatar_image, discord_avatar,
                     CAST(discord_id AS TEXT) AS discord_id
              FROM players WHERE name IN (${placeholders})`,
        args: names,
      });
      for (const r of rs.rows as unknown as Record<string, unknown>[]) {
        byName.set(r.name as string, {
          avatar:
            pickAvatar(
              r.roblox_avatar_image as string | null,
              r.discord_avatar as string | null,
              r.discord_id as string | null
            ) || null,
          rank: mapRank((r.rank as string) || ""),
          elo: Number(r.elo ?? 0),
        });
      }
    } catch {
      /* players table unreadable — fall back to bare names */
    }
  }
  const byDiscordId = await resolveAvatarsByDiscordId(raw.members.map((m) => m.discordId));
  const voiceChannelId = raw.voiceChannelId ?? null;
  const selected = raw.selectedMap ?? raw.map ?? null;
  const serverUrl = raw.server?.url?.trim() || null;
  let messages: ChatMessage[] = [];
  try {
    messages = await listLobbyChat(raw.channelId);
  } catch {
    /* chat table may not exist yet */
  }
  return {
    channelId: raw.channelId,
    channelName: raw.channelName,
    guildId: raw.guildId,
    channelUrl: discordUrl(raw.guildId, raw.channelId),
    voiceChannelId,
    voiceChannelUrl: voiceChannelId ? discordUrl(raw.guildId, voiceChannelId) : null,
    map: selected,
    selectedMap: selected,
    status: raw.status || "veto",
    side: raw.side ?? null,
    captains: {
      team1: raw.captains?.team1 ?? null,
      team2: raw.captains?.team2 ?? null,
    },
    veto: normalizeVeto(raw),
    createdAt: raw.createdAt,
    members: raw.members.map((m) => ({
      discordId: m.discordId,
      name: m.name,
      team: m.team,
      avatar: byDiscordId.get(m.discordId) || byName.get(m.name)?.avatar || null,
      rank: byName.get(m.name)?.rank ?? "UNRANKED",
      elo: byName.get(m.name)?.elo ?? 0,
      left: !!m.left,
      sub: !!m.sub,
    })),
    server: serverUrl ? { url: serverUrl } : null,
    messages,
  };
}

async function loadLobbyRows() {
  try {
    return (await client.execute("SELECT id, data, created_at FROM web_lobbies")).rows;
  } catch {
    return null;
  }
}

async function pruneExpired(ids: string[]) {
  if (ids.length === 0) return;
  try {
    await client.batch(ids.map((id) => ({ sql: "DELETE FROM web_lobbies WHERE id = ?", args: [id] })));
  } catch {
    /* best-effort prune */
  }
}

/**
 * The set of Discord ids currently in a live match lobby (across all lobbies),
 * pruning expired rows as it scans. Used to block re-queueing while a player's
 * match is still open. One query, so it's cheap to call on every queue join.
 */
export async function getActiveLobbyMemberIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const rows = await loadLobbyRows();
  if (!rows) return ids;
  const cutoff = Date.now() - LOBBY_TTL_MS;
  const expired: string[] = [];
  for (const row of rows) {
    if (Number(row.created_at) < cutoff) {
      expired.push(row.id as string);
      continue;
    }
    try {
      const data = JSON.parse(row.data as string) as RawLobby;
      for (const m of data.members ?? []) ids.add(m.discordId);
    } catch {
      expired.push(row.id as string);
    }
  }
  await pruneExpired(expired);
  return ids;
}

/**
 * The active lobby the given Discord user is in, or null. Prunes rows older
 * than the TTL as it scans (best-effort).
 */
export async function getLobbyForUser(discordId: string): Promise<LobbyView | null> {
  const rows = await loadLobbyRows();
  if (!rows) return null;

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

  await pruneExpired(expired);
  return mine ? enrich(mine) : null;
}

export type VetoResult =
  | { ok: true; lobby: LobbyView }
  | { ok: false; error: string; status: number };

/** Captain bans a map from the website. Bot poll applies it to Discord. */
export async function applyWebsiteMapBan(
  discordId: string,
  mapName: string
): Promise<VetoResult> {
  const rows = await loadLobbyRows();
  if (!rows) return { ok: false, error: "No live match.", status: 404 };

  const cutoff = Date.now() - LOBBY_TTL_MS;
  let rowId: string | null = null;
  let data: RawLobby | null = null;

  for (const row of rows) {
    if (Number(row.created_at) < cutoff) continue;
    try {
      const parsed = JSON.parse(row.data as string) as RawLobby;
      if (parsed.members?.some((m) => m.discordId === discordId)) {
        rowId = row.id as string;
        data = parsed;
        break;
      }
    } catch {
      /* skip */
    }
  }

  if (!rowId || !data) return { ok: false, error: "You're not in a live match.", status: 404 };

  const veto = normalizeVeto(data);
  if (!veto || veto.complete || !veto.available) {
    return { ok: false, error: "Map veto is already finished.", status: 409 };
  }
  if (veto.currentTurnCaptainId !== discordId) {
    return { ok: false, error: "It's not your turn to ban.", status: 403 };
  }
  if (!veto.remainingMaps.includes(mapName)) {
    return { ok: false, error: "That map is not available.", status: 400 };
  }

  const remaining = veto.remainingMaps.filter((m) => m !== mapName);
  const history = [...veto.history, { map: mapName, bannedByCaptainId: discordId }];
  const complete = remaining.length === 1;
  const otherCaptain =
    data.captains?.team1 === discordId ? data.captains?.team2 ?? null : data.captains?.team1 ?? null;

  const nextVeto: VetoState = {
    available: !complete,
    actionSource: "website",
    remainingMaps: remaining,
    history,
    currentTurnCaptainId: complete ? null : otherCaptain,
    complete,
    turnDeadlineAt: complete ? null : Date.now() + 30_000,
  };

  const chosen = complete ? remaining[0] : data.selectedMap ?? data.map ?? null;
  const next: RawLobby = {
    ...data,
    veto: nextVeto,
    selectedMap: chosen,
    map: chosen,
    status: complete ? "side_selection" : "veto",
  };

  try {
    await client.execute({
      sql: "UPDATE web_lobbies SET data = ? WHERE id = ?",
      args: [JSON.stringify(next), rowId],
    });
  } catch {
    return { ok: false, error: "Failed to save veto.", status: 500 };
  }

  return { ok: true, lobby: await enrich(next) };
}
