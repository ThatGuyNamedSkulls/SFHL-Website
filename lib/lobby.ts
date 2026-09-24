/**
 * Post-queue lobbies: shared matchroom between Discord and the website.
 * The bot writes `web_lobbies` (id = Discord channel id). The site reads it
 * and can apply captain map bans (`veto.actionSource = "website"`), which the
 * bot then reconciles onto the live Discord MapVoteView.
 */

import { client, publicRating, ensurePlayerDiscordColumns } from "@/lib/db";
import { perceivedSkill, teamWinChances } from "@/lib/win-chance";
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
  /** False while the player is still in placements. Their Elo is not shown. */
  placementDone: boolean;
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

export interface SidePickState {
  captainId: string;
  team: number;
  options: string[];
}

export interface LobbyView {
  channelId: string;
  channelName: string;
  guildId: string;
  /** Discord deep link to the match text channel. */
  channelUrl: string;
  /** Private team voice channel id for this viewer (players + Match Staff). */
  voiceChannelId: string | null;
  /** Discord deep link to this viewer's team voice channel. */
  voiceChannelUrl: string | null;
  map: string | null;
  selectedMap: string | null;
  status: string;
  side: { name: string; team: number } | null;
  sidePick: SidePickState | null;
  firstVetoCaptainId: string | null;
  captains: { team1: string | null; team2: string | null };
  veto: VetoState | null;
  createdAt: number;
  members: LobbyMemberView[];
  /** Pre-match win chance from perceived ratings. Null if a side is empty. */
  winChance: { team1: number; team2: number } | null;
  server: { url: string } | null;
  matchNumber: number | null;
  /** Which queue made this match: "standard" | "super" | "pro". */
  queueMode: string | null;
  messages: ChatMessage[];
}

interface RawLobby {
  id?: string;
  channelId: string;
  channelName: string;
  guildId: string;
  voiceChannelId?: string | null;
  voiceChannelName?: string | null;
  voiceChannels?: Record<string, { id?: string; name?: string } | string>;
  map?: string | null;
  selectedMap?: string | null;
  status?: string;
  side?: {
    name: string;
    team: number;
    selectedByCaptainId?: string;
    actionSource?: string;
  } | null;
  sidePick?: Partial<SidePickState> | null;
  firstVetoCaptainId?: string | null;
  captains?: { team1?: string; team2?: string };
  veto?: Partial<VetoState> | null;
  createdAt: number;
  members: { discordId: string; name: string; team: number; left?: boolean; sub?: boolean }[];
  server?: { url?: string } | null;
  matchNumber?: number | null;
  queueMode?: string | null;
}

function discordUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Opens a guild channel in the Discord desktop/mobile app, not discord.com. */
function discordAppUrl(guildId: string, channelId: string) {
  return `discord://-/channels/${guildId}/${channelId}`;
}

function voiceIdForViewer(raw: RawLobby, viewerDiscordId?: string | null): string | null {
  const channels = raw.voiceChannels;
  const hasTeams = !!channels && Object.keys(channels).length > 0;
  if (hasTeams) {
    if (!viewerDiscordId) return null;
    const team = raw.members?.find((m) => m.discordId === viewerDiscordId)?.team;
    if (!team) return null;
    const entry = channels[String(team)] ?? channels[team as unknown as string];
    if (entry && typeof entry === "object" && entry.id) return String(entry.id);
    if (typeof entry === "string" && entry) return entry;
    return null;
  }
  return raw.voiceChannelId ?? null;
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

const DEFAULT_SIDES = ["CT", "T"];

function normalizeSidePick(raw: RawLobby): SidePickState | null {
  const s = raw.sidePick;
  if (!s?.captainId) return null;
  return {
    captainId: String(s.captainId),
    team: Number(s.team) || 1,
    options: Array.isArray(s.options) && s.options.length ? s.options.map(String) : DEFAULT_SIDES,
  };
}

function resolveSidePicker(data: RawLobby): { captainId: string; team: number; options: string[] } | null {
  const fromState = normalizeSidePick(data);
  const captainId =
    fromState?.captainId ||
    data.firstVetoCaptainId ||
    data.veto?.history?.[0]?.bannedByCaptainId ||
    data.captains?.team1 ||
    null;
  if (!captainId) return null;
  let team = fromState?.team || 0;
  if (!team) {
    if (data.captains?.team1 === captainId) team = 1;
    else if (data.captains?.team2 === captainId) team = 2;
    else team = 1;
  }
  return {
    captainId,
    team,
    options: fromState?.options?.length ? fromState.options : DEFAULT_SIDES,
  };
}

/** Enrich the raw members with avatar, rank, and elo from the players table (one query). */
async function enrich(raw: RawLobby, viewerDiscordId?: string | null): Promise<LobbyView> {
  const names = raw.members.map((m) => m.name);
  const byName = new Map<
    string,
    { avatar: string | null; rank: string; elo: number; placementDone: boolean; skill: number }
  >();
  if (names.length > 0) {
    const placeholders = names.map(() => "?").join(",");
    try {
      await ensurePlayerDiscordColumns();
      let playerRows: Record<string, unknown>[];
      try {
        const rs = await client.execute({
          sql: `SELECT name, rank, elo, mmr, placement_done, roblox_avatar_image, discord_avatar,
                       discord_id
                FROM players WHERE name IN (${placeholders})`,
          args: names,
        });
        playerRows = rs.rows as unknown as Record<string, unknown>[];
      } catch {
        const rs = await client.execute({
          sql: `SELECT name, rank, elo, placement_done, roblox_avatar_image, discord_avatar,
                       discord_id
                FROM players WHERE name IN (${placeholders})`,
          args: names,
        });
        playerRows = rs.rows as unknown as Record<string, unknown>[];
      }
      for (const r of playerRows) {
        const rating = publicRating({
          elo: Number(r.elo ?? 0),
          rank: String(r.rank || ""),
          placement_done: Number(r.placement_done ?? 0),
        });
        byName.set(r.name as string, {
          avatar:
            pickAvatar(
              r.roblox_avatar_image as string | null,
              r.discord_avatar as string | null,
              r.discord_id as string | null
            ) || null,
          rank: rating.rank,
          elo: rating.elo,
          placementDone: rating.placementDone,
          skill: perceivedSkill({
            placementDone: rating.placementDone,
            elo: Number(r.elo ?? 0),
            mmr: r.mmr == null ? null : Number(r.mmr),
          }),
        });
      }
    } catch {
      /* players table unreadable — fall back to bare names */
    }
  }
  const byDiscordId = await resolveAvatarsByDiscordId(raw.members.map((m) => m.discordId));
  const voiceChannelId = voiceIdForViewer(raw, viewerDiscordId);
  const selected = raw.selectedMap ?? raw.map ?? null;
  const serverUrl = raw.server?.url?.trim() || null;
  let messages: ChatMessage[] = [];
  try {
    messages = await listLobbyChat(raw.channelId);
  } catch {
    /* chat table may not exist yet */
  }
  const members = raw.members.map((m) => ({
    discordId: m.discordId,
    name: m.name,
    team: m.team,
    avatar: byDiscordId.get(m.discordId) || byName.get(m.name)?.avatar || null,
    rank: byName.get(m.name)?.rank ?? "UNRANKED",
    elo: byName.get(m.name)?.elo ?? 0,
    placementDone: byName.get(m.name)?.placementDone ?? false,
    skill: byName.get(m.name)?.skill ?? 1200,
    left: !!m.left,
    sub: !!m.sub,
  }));
  const chances = teamWinChances(
    members.filter((m) => m.team === 1).map((m) => ({ skill: m.skill, left_early: m.left ? 1 : 0, is_sub: m.sub ? 1 : 0 })),
    members.filter((m) => m.team === 2).map((m) => ({ skill: m.skill, left_early: m.left ? 1 : 0, is_sub: m.sub ? 1 : 0 }))
  );

  return {
    channelId: raw.channelId,
    channelName: raw.channelName,
    guildId: raw.guildId,
    channelUrl: discordUrl(raw.guildId, raw.channelId),
    voiceChannelId,
    voiceChannelUrl: voiceChannelId ? discordAppUrl(raw.guildId, voiceChannelId) : null,
    map: selected,
    selectedMap: selected,
    status: raw.status || "veto",
    side: raw.side ?? null,
    sidePick: normalizeSidePick(raw),
    firstVetoCaptainId: raw.firstVetoCaptainId ?? null,
    captains: {
      team1: raw.captains?.team1 ?? null,
      team2: raw.captains?.team2 ?? null,
    },
    veto: normalizeVeto(raw),
    createdAt: raw.createdAt,
    members: members.map(({ skill: _skill, ...member }) => member),
    winChance: chances ? { team1: chances.teamA, team2: chances.teamB } : null,
    server: serverUrl ? { url: serverUrl } : null,
    matchNumber:
      typeof raw.matchNumber === "number" && raw.matchNumber > 0
        ? raw.matchNumber
        : Number.parseInt(
            String(raw.channelName || "").match(/^queue-game-(\d+)$/i)?.[1] || "",
            10
          ) || null,
    queueMode: typeof raw.queueMode === "string" ? raw.queueMode : null,
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
  return mine ? enrich(mine, discordId) : null;
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
  const picker = complete ? resolveSidePicker(data) : null;
  const next: RawLobby = {
    ...data,
    veto: nextVeto,
    selectedMap: chosen,
    map: chosen,
    status: complete ? (picker ? "side_selection" : "ready_to_play") : "veto",
    ...(complete && picker
      ? {
          sidePick: {
            captainId: picker.captainId,
            team: picker.team,
            options: picker.options,
          },
        }
      : {}),
  };

  try {
    await client.execute({
      sql: "UPDATE web_lobbies SET data = ? WHERE id = ?",
      args: [JSON.stringify(next), rowId],
    });
  } catch {
    return { ok: false, error: "Failed to save veto.", status: 500 };
  }

  return { ok: true, lobby: await enrich(next, discordId) };
}

/** Captain picks CT/T from the website. Bot poll applies it to Discord. */
export async function applyWebsiteSidePick(
  discordId: string,
  sideName: string
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
  if (data.side?.name) {
    return { ok: false, error: "Starting side is already picked.", status: 409 };
  }

  const veto = normalizeVeto(data);
  const mapReady = !!veto?.complete || data.status === "side_selection";
  if (!mapReady) {
    return { ok: false, error: "Map veto is still in progress.", status: 409 };
  }

  const picker = resolveSidePicker(data);
  if (!picker) {
    return { ok: false, error: "Side pick is not available.", status: 409 };
  }
  if (picker.captainId !== discordId) {
    return { ok: false, error: "It's not your turn to pick a side.", status: 403 };
  }

  const name = sideName.trim();
  if (!picker.options.includes(name)) {
    return { ok: false, error: "That side is not available.", status: 400 };
  }

  const next: RawLobby = {
    ...data,
    status: "ready_to_play",
    sidePick: null,
    side: {
      name,
      team: picker.team,
      selectedByCaptainId: discordId,
      actionSource: "website",
    },
  };

  try {
    await client.execute({
      sql: "UPDATE web_lobbies SET data = ? WHERE id = ?",
      args: [JSON.stringify(next), rowId],
    });
  } catch {
    return { ok: false, error: "Failed to save side pick.", status: 500 };
  }

  return { ok: true, lobby: await enrich(next, discordId) };
}
