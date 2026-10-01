/**
 * Match-channel chat stored in Turso and mirrored with Discord.
 */

import { maskProfanity } from "@/lib/content-moderation";
import { client } from "@/lib/db";
import { discordSafe } from "@/lib/discord-safe";
import { schemaOnce } from "@/lib/schema-once";

export interface ChatMessage {
  id: number;
  authorId: string;
  authorName: string;
  content: string;
  source: "discord" | "website";
  createdAt: number;
}

let schemaReady: Promise<void> | null = null;

/** Once per code version (schemaOnce), not on every new server instance. */
export function ensureLobbyChatSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = schemaOnce("lobby_chat", async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_lobby_messages (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           channel_id TEXT NOT NULL,
           discord_message_id TEXT,
           discord_id TEXT NOT NULL,
           author_name TEXT NOT NULL,
           content TEXT NOT NULL,
           source TEXT NOT NULL,
           created_at INTEGER NOT NULL
         )`
      );
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

export async function listLobbyChat(channelId: string, limit = 80): Promise<ChatMessage[]> {
  await ensureLobbyChatSchema();
  const rs = await client.execute({
    sql: `SELECT id, discord_id, author_name, content, source, created_at
          FROM web_lobby_messages
          WHERE channel_id = ?
          ORDER BY id DESC
          LIMIT ?`,
    args: [channelId, limit],
  });
  return [...rs.rows].reverse().map((r) => ({
    id: Number(r.id),
    authorId: String(r.discord_id),
    authorName: String(r.author_name),
    // Messages typed on the site were checked when sent; the ones the bot
    // mirrors in from the Discord match channel never were.
    content: maskProfanity(String(r.content)),
    source: r.source === "website" ? "website" : "discord",
    createdAt: Number(r.created_at ?? 0),
  }));
}

export async function postLobbyChat(input: {
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
}): Promise<ChatMessage | { error: string }> {
  const text = input.content.trim().slice(0, 400);
  if (!text) return { error: "Message is empty" };
  await ensureLobbyChatSchema();
  const now = Date.now();
  const ins = await client.execute({
    sql: `INSERT INTO web_lobby_messages
          (channel_id, discord_message_id, discord_id, author_name, content, source, created_at)
          VALUES (?, 'pending', ?, ?, ?, 'website', ?)`,
    args: [input.channelId, input.authorId, input.authorName.slice(0, 80), text, now],
  });
  const id = Number(ins.lastInsertRowid ?? 0);
  const msg: ChatMessage = {
    id,
    authorId: input.authorId,
    authorName: input.authorName.slice(0, 80),
    content: text,
    source: "website",
    createdAt: now,
  };
  const discordId = await postToDiscordChannel(input.channelId, input.authorName, text);
  if (id) {
    await client.execute({
      sql: "UPDATE web_lobby_messages SET discord_message_id = ? WHERE id = ?",
      args: [discordId, id],
    });
  }
  return msg;
}

async function postToDiscordChannel(
  channelId: string,
  authorName: string,
  content: string
): Promise<string | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // User text is escaped: no masked links, markdown or pings from the site.
        content: `**${discordSafe(authorName, 80)}:** ${discordSafe(content, 400)}`,
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      console.error("Failed to mirror website chat to Discord", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}
