/**
 * Private Discord party voice channels.
 * Created with the bot token when a website party is created; members get
 * connect permission and a DM with the join link.
 */

import { DISCORD_CONFIG } from "@/lib/auth";
import { addNotification, enqueueDM } from "@/lib/social";

const VIEW_CHANNEL = 1 << 10;
const STREAM = 1 << 9;
const CONNECT = 1 << 20;
const SPEAK = 1 << 21;
const VOICE_ALLOW = VIEW_CHANNEL | CONNECT | SPEAK | STREAM;
const VOICE_DENY = VIEW_CHANNEL | CONNECT;

export interface PartyVoiceInfo {
  voiceChannelId: string;
  voiceChannelUrl: string;
  guildId: string;
}

function botToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN || null;
}

async function discordApi(path: string, init?: RequestInit): Promise<Response | null> {
  const token = botToken();
  if (!token) return null;
  try {
    return await fetch(`https://discord.com/api/v10${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return null;
  }
}

let staffRoleId: string | null | undefined;

async function matchStaffRoleId(): Promise<string | null> {
  if (staffRoleId !== undefined) return staffRoleId;
  const res = await discordApi(`/guilds/${DISCORD_CONFIG.guildId}/roles`);
  if (!res?.ok) {
    staffRoleId = null;
    return null;
  }
  const roles = (await res.json()) as { id: string; name: string }[];
  staffRoleId = roles.find((r) => r.name === "[MS] Match Staff")?.id ?? null;
  return staffRoleId;
}

/** True when this Discord user has the Match Staff role in the league server. */
export async function isMatchStaff(userId: string): Promise<boolean> {
  const roleId = await matchStaffRoleId();
  if (!roleId || !userId) return false;
  const res = await discordApi(`/guilds/${DISCORD_CONFIG.guildId}/members/${userId}`);
  if (!res?.ok) return false;
  const member = (await res.json()) as { roles?: string[] };
  return (member.roles ?? []).includes(roleId);
}

function channelUrl(channelId: string) {
  return `discord://-/channels/${DISCORD_CONFIG.guildId}/${channelId}`;
}

export function partyVoiceAppUrl(
  channelId: string | null | undefined,
  guildId?: string | null
): string | null {
  if (!channelId) return null;
  return `discord://-/channels/${guildId || DISCORD_CONFIG.guildId}/${channelId}`;
}

function slug(name: string) {
  return name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20).toLowerCase() || "hl";
}

/** Create a private VC for this party (leader + Match Staff can see it). */
export async function createPartyVoiceChannel(
  partyId: string,
  leaderName: string,
  memberDiscordIds: string[]
): Promise<PartyVoiceInfo | null> {
  const staff = await matchStaffRoleId();
  const overwrites: { id: string; type: number; allow: string; deny: string }[] = [
    { id: DISCORD_CONFIG.guildId, type: 0, allow: "0", deny: String(VOICE_DENY) },
  ];
  if (staff) {
    overwrites.push({ id: staff, type: 0, allow: String(VOICE_ALLOW), deny: "0" });
  }
  for (const id of memberDiscordIds) {
    overwrites.push({ id, type: 1, allow: String(VOICE_ALLOW), deny: "0" });
  }

  const res = await discordApi(`/guilds/${DISCORD_CONFIG.guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: `party-${slug(leaderName)}-${partyId}`,
      type: 2,
      permission_overwrites: overwrites,
    }),
  });
  if (!res?.ok) {
    console.error("Failed to create party voice", res?.status, await res?.text().catch(() => ""));
    return null;
  }
  const ch = (await res.json()) as { id: string };
  return {
    voiceChannelId: ch.id,
    voiceChannelUrl: channelUrl(ch.id),
    guildId: DISCORD_CONFIG.guildId,
  };
}

/** Grant connect to current members; drop overwrites for people who left. */
export async function syncPartyVoiceMembers(
  voiceChannelId: string,
  memberDiscordIds: string[],
  previousIds: string[]
): Promise<void> {
  const staff = await matchStaffRoleId();
  const keep = new Set(memberDiscordIds);
  if (staff) keep.add(staff);
  keep.add(DISCORD_CONFIG.guildId);

  for (const id of previousIds) {
    if (keep.has(id)) continue;
    await discordApi(`/channels/${voiceChannelId}/permissions/${id}`, { method: "DELETE" });
  }
  for (const id of memberDiscordIds) {
    await discordApi(`/channels/${voiceChannelId}/permissions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ type: 1, allow: String(VOICE_ALLOW), deny: "0" }),
    });
  }
}

export async function deletePartyVoiceChannel(voiceChannelId: string | null | undefined): Promise<void> {
  if (!voiceChannelId) return;
  await discordApi(`/channels/${voiceChannelId}`, { method: "DELETE" });
}

/** Website notification + Discord DM asking the player to join party voice. */
export async function promptJoinPartyVoice(
  playerName: string | null,
  voice: { voiceChannelId: string; voiceChannelUrl: string }
): Promise<void> {
  if (!playerName) return;
  const mention = `<#${voice.voiceChannelId}>`;
  const msg = `Join your party voice on Discord: ${mention}`;
  try {
    await addNotification(playerName, "party_voice", msg, null, voice.voiceChannelUrl);
    await enqueueDM(
      playerName,
      `🔊 **Party voice is ready.** Click to join:\n${mention}`
    );
  } catch {
    /* social schema / DM outbox not ready */
  }
}
