import { NextResponse } from "next/server";
import { parseMentions, segmentsToText, type MentionSegment } from "@/lib/discord-mentions";

const ANNOUNCEMENTS_CHANNEL_ID = "1275469567006740575";
const DISCORD_API = "https://discord.com/api/v10";

/** Simple in-memory cache to avoid hammering the Discord API / rate limits. */
let cache: { at: number; data: Announcement[] } | null = null;
const CACHE_TTL_MS = 60 * 1000;
/** Role and channel names change rarely; refresh them every 10 minutes. */
let guildCache: { at: number; roles: Map<string, { name: string; color: number }>; channels: Map<string, string> } | null = null;
const GUILD_TTL_MS = 10 * 60 * 1000;
const GUILD_ID = process.env.SFHL_GUILD_ID || "973987866336190484";

interface Announcement {
  id: string;
  author: string;
  avatar: string | null;
  /** Readable text: role/channel/user mentions shown by name. */
  content: string;
  /** The same content split into text and mention pieces for styling. */
  segments: MentionSegment[];
  timestamp: string;
  attachments: string[];
}

/** Resolve the bot token from env (set DISCORD_BOT_TOKEN in Vercel / .env.local). */
function getBotToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  author: { username: string; global_name?: string; id: string; avatar: string | null };
  attachments: { url: string }[];
  mentions?: { id: string; username: string; global_name?: string | null }[];
}

/** The server's roles and channels, for turning <@&id> / <#id> into names. */
async function guildNames(token: string) {
  if (guildCache && Date.now() - guildCache.at < GUILD_TTL_MS) return guildCache;
  const headers = { Authorization: `Bot ${token}` };
  const [rolesRes, channelsRes] = await Promise.all([
    fetch(`${DISCORD_API}/guilds/${GUILD_ID}/roles`, { headers, cache: "no-store" }),
    fetch(`${DISCORD_API}/guilds/${GUILD_ID}/channels`, { headers, cache: "no-store" }),
  ]);
  const roles = new Map<string, { name: string; color: number }>();
  const channels = new Map<string, string>();
  if (rolesRes.ok) {
    for (const r of (await rolesRes.json()) as { id: string; name: string; color: number }[]) {
      roles.set(r.id, { name: r.name, color: r.color });
    }
  }
  if (channelsRes.ok) {
    for (const c of (await channelsRes.json()) as { id: string; name: string }[]) {
      channels.set(c.id, c.name);
    }
  }
  // Keep a stale copy rather than showing raw ids if Discord hiccups.
  if (roles.size || channels.size || !guildCache) {
    guildCache = { at: Date.now(), roles, channels };
  }
  return guildCache;
}

/** GET — recent messages from the #announcements channel. */
export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ announcements: cache.data, cached: true });
  }

  const token = getBotToken();
  if (!token) {
    return NextResponse.json(
      { announcements: [], error: "Discord bot token not configured" },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(
        `${DISCORD_API}/channels/${ANNOUNCEMENTS_CHANNEL_ID}/messages?limit=20`,
      {
        headers: { Authorization: `Bot ${token}` },
        // Never cache at the fetch layer — we manage our own TTL above.
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { announcements: [], error: `Discord API returned ${res.status}` },
        { status: 200 }
      );
    }

    const messages = (await res.json()) as DiscordMessage[];
    const names = await guildNames(token).catch(() => ({
      roles: new Map<string, { name: string; color: number }>(),
      channels: new Map<string, string>(),
    }));
    const announcements: Announcement[] = messages
      .filter((m) => m.content || m.attachments.length > 0)
      .map((m) => {
        const segments = parseMentions(m.content, {
          roles: names.roles,
          channels: names.channels,
          users: new Map((m.mentions ?? []).map((u) => [u.id, u.global_name || u.username])),
          guildId: GUILD_ID,
        });
        return {
          id: m.id,
          author: m.author.global_name || m.author.username,
          avatar: m.author.avatar
            ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64`
            : null,
          content: segmentsToText(segments),
          segments,
          timestamp: m.timestamp,
          attachments: m.attachments.map((a) => a.url),
        };
      });

    cache = { at: Date.now(), data: announcements };
    return NextResponse.json({ announcements });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return NextResponse.json({ announcements: [], error: "Failed to fetch announcements" }, { status: 200 });
  }
}
