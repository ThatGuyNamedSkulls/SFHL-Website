import { client } from "@/lib/db";
import { getParty } from "@/lib/parties";

export const PARTY_CHAT_MAX_LENGTH = 250;
const CHAT_LIMIT = 80;
/** Parties are short-lived (they expire after 30 idle minutes), so old party
 *  chat is swept on each post instead of kept forever. */
const RETAIN_MS = 24 * 60 * 60 * 1000;

export interface PartyChatMessage {
  id: number;
  partyId: string;
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  message: string;
  createdAt: number;
}

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_party_chat (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           party_id TEXT NOT NULL,
           discord_id TEXT NOT NULL,
           username TEXT NOT NULL,
           player_name TEXT,
           player_id INTEGER,
           avatar TEXT,
           message TEXT NOT NULL,
           created_at INTEGER NOT NULL
         )`
      );
      await client
        .execute(
          "CREATE INDEX IF NOT EXISTS idx_web_party_chat_party ON web_party_chat (party_id, id)"
        )
        .catch(() => undefined);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

function rowToMessage(row: Record<string, unknown>): PartyChatMessage {
  return {
    id: Number(row.id),
    partyId: String(row.party_id),
    discordId: String(row.discord_id),
    username: String(row.username),
    playerName: row.player_name == null ? null : String(row.player_name),
    avatar: row.avatar == null ? null : String(row.avatar),
    message: String(row.message),
    createdAt: Number(row.created_at),
  };
}

/** Throws unless `discordId` is in the live party. */
export async function assertPartyMember(partyId: string, discordId: string): Promise<void> {
  const party = await getParty(partyId);
  if (!party) throw new PartyChatError("Party not found.", 404);
  if (!party.members.some((m) => m.discordId === discordId)) {
    throw new PartyChatError("Join the party to use its chat.", 403);
  }
}

export class PartyChatError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Latest messages, oldest first. With `afterId`, only messages newer than it. */
export async function listPartyChat(partyId: string, afterId = 0): Promise<PartyChatMessage[]> {
  await ensureSchema();
  const rs = await client.execute({
    sql: `SELECT id, party_id, discord_id, username, player_name, avatar, message, created_at
          FROM web_party_chat
          WHERE party_id = ? AND id > ?
          ORDER BY id DESC
          LIMIT ?`,
    args: [partyId, afterId, CHAT_LIMIT],
  });
  return rs.rows
    .map((row) => rowToMessage(row as unknown as Record<string, unknown>))
    .reverse();
}

export async function postPartyChat(
  partyId: string,
  author: {
    discordId: string;
    username: string;
    playerName: string | null;
    avatar: string | null;
  },
  message: string
): Promise<PartyChatMessage> {
  await assertPartyMember(partyId, author.discordId);
  const text = message.trim();
  if (text.length < 1 || text.length > PARTY_CHAT_MAX_LENGTH) {
    throw new PartyChatError(`Message must be 1–${PARTY_CHAT_MAX_LENGTH} characters.`, 400);
  }
  await ensureSchema();
  const createdAt = Date.now();
  const rs = await client.execute({
    sql: `INSERT INTO web_party_chat
          (party_id, discord_id, username, player_name, player_id, avatar, message, created_at)
          VALUES (?, ?, ?, ?, (SELECT id FROM players WHERE name = ?), ?, ?, ?)`,
    args: [
      partyId,
      author.discordId,
      author.username,
      author.playerName,
      author.playerName,
      author.avatar,
      text,
      createdAt,
    ],
  });
  await client
    .execute({ sql: "DELETE FROM web_party_chat WHERE created_at < ?", args: [createdAt - RETAIN_MS] })
    .catch(() => undefined);
  return {
    id: Number(rs.lastInsertRowid ?? 0),
    partyId,
    discordId: author.discordId,
    username: author.username,
    playerName: author.playerName,
    avatar: author.avatar,
    message: text,
    createdAt,
  };
}

/** Authors can delete their own messages; the party leader can delete any. */
export async function deletePartyChat(
  partyId: string,
  actorId: string,
  messageId: number
): Promise<void> {
  const party = await getParty(partyId);
  if (!party) throw new PartyChatError("Party not found.", 404);
  await ensureSchema();
  const rs = await client.execute({
    sql: "SELECT discord_id FROM web_party_chat WHERE id = ? AND party_id = ?",
    args: [messageId, partyId],
  });
  if (rs.rows.length === 0) throw new PartyChatError("Message not found.", 404);
  const authorId = String(rs.rows[0].discord_id);
  if (authorId !== actorId && party.leaderId !== actorId) {
    throw new PartyChatError("You can only delete your own messages.", 403);
  }
  await client.execute({
    sql: "DELETE FROM web_party_chat WHERE id = ? AND party_id = ?",
    args: [messageId, partyId],
  });
}
