import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ANNOUNCEMENTS_CHANNEL_ID = "1275469567006740575";
const DISCORD_API = "https://discord.com/api/v10";

/** Simple in-memory cache to avoid hammering the Discord API / rate limits. */
let cache: { at: number; data: Announcement[] } | null = null;
const CACHE_TTL_MS = 60 * 1000;

interface Announcement {
  id: string;
  author: string;
  avatar: string | null;
  content: string;
  timestamp: string;
  attachments: string[];
}

/** Resolve the bot token from env, or fall back to the shared bot .env file. */
function getBotToken(): string | null {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN;
  try {
    const envPath = path.resolve(process.cwd(), "..", "..", ".env");
    const raw = fs.readFileSync(envPath, "utf-8");
    const match = raw.match(/^DISCORD_TOKEN\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // ignore
  }
  return null;
}

interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  author: { username: string; global_name?: string; id: string; avatar: string | null };
  attachments: { url: string }[];
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
      `${DISCORD_API}/channels/${ANNOUNCEMENTS_CHANNEL_ID}/messages?limit=5`,
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
    const announcements: Announcement[] = messages
      .filter((m) => m.content || m.attachments.length > 0)
      .map((m) => ({
        id: m.id,
        author: m.author.global_name || m.author.username,
        avatar: m.author.avatar
          ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64`
          : null,
        content: m.content,
        timestamp: m.timestamp,
        attachments: m.attachments.map((a) => a.url),
      }));

    cache = { at: Date.now(), data: announcements };
    return NextResponse.json({ announcements });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return NextResponse.json({ announcements: [], error: "Failed to fetch announcements" }, { status: 200 });
  }
}
