import { client } from "@/lib/db";
import { getClub, memberOf } from "@/lib/clubs";

export const CLUB_CHAT_MAX_LENGTH = 250;
const CHAT_LIMIT = 80;

export interface ClubChatMessage {
  id: number;
  clubId: string;
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
        `CREATE TABLE IF NOT EXISTS web_club_chat (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           club_id TEXT NOT NULL,
           discord_id TEXT NOT NULL,
           username TEXT NOT NULL,
           player_name TEXT,
           avatar TEXT,
           message TEXT NOT NULL,
           created_at INTEGER NOT NULL
         )`
      );
      await client
        .execute(
          "CREATE INDEX IF NOT EXISTS idx_web_club_chat_club ON web_club_chat (club_id, created_at)"
        )
        .catch(() => undefined);
      // player_id (Phase 1 of the players(name) -> players(id) FK migration;
      // see docs/DATABASE_PK_FK_RELATIONSHIPS.docx). web_club_chat had no
      // player FK governance at all before Phase 1.
      await client
        .execute("ALTER TABLE web_club_chat ADD COLUMN player_id INTEGER")
        .catch(() => undefined);
    })();
  }
  return schemaReady;
}

function rowToMessage(row: Record<string, unknown>): ClubChatMessage {
  return {
    id: Number(row.id),
    clubId: String(row.club_id),
    discordId: String(row.discord_id),
    username: String(row.username),
    playerName: row.player_name == null ? null : String(row.player_name),
    avatar: row.avatar == null ? null : String(row.avatar),
    message: String(row.message),
    createdAt: Number(row.created_at),
  };
}

export async function listClubChat(clubId: string): Promise<ClubChatMessage[]> {
  await ensureSchema();
  const rs = await client.execute({
    sql: `SELECT id, club_id, discord_id, username, player_name, avatar, message, created_at
          FROM web_club_chat
          WHERE club_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [clubId, CHAT_LIMIT],
  });
  return rs.rows
    .map((row) => rowToMessage(row as unknown as Record<string, unknown>))
    .reverse();
}

export async function postClubChat(
  clubId: string,
  author: {
    discordId: string;
    username: string;
    playerName: string | null;
    avatar: string | null;
  },
  message: string
): Promise<ClubChatMessage> {
  const club = await getClub(clubId);
  if (!club) throw new Error("Club not found.");
  if (!memberOf(club, author.discordId)) throw new Error("Join the club to chat.");
  const text = message.trim();
  if (text.length < 1 || text.length > CLUB_CHAT_MAX_LENGTH) {
    throw new Error(`Message must be 1–${CLUB_CHAT_MAX_LENGTH} characters.`);
  }
  await ensureSchema();
  const createdAt = Date.now();
  const rs = await client.execute({
    sql: `INSERT INTO web_club_chat
          (club_id, discord_id, username, player_name, player_id, avatar, message, created_at)
          VALUES (?, ?, ?, ?, (SELECT id FROM players WHERE name = ?), ?, ?, ?)`,
    args: [
      clubId,
      author.discordId,
      author.username,
      author.playerName,
      author.playerName,
      author.avatar,
      text,
      createdAt,
    ],
  });
  return {
    id: Number(rs.lastInsertRowid ?? 0),
    clubId,
    discordId: author.discordId,
    username: author.username,
    playerName: author.playerName,
    avatar: author.avatar,
    message: text,
    createdAt,
  };
}

export async function deleteClubChat(
  clubId: string,
  actorId: string,
  messageId: number
): Promise<void> {
  const club = await getClub(clubId);
  if (!club) throw new Error("Club not found.");
  await ensureSchema();
  const rs = await client.execute({
    sql: "SELECT discord_id FROM web_club_chat WHERE id = ? AND club_id = ?",
    args: [messageId, clubId],
  });
  if (rs.rows.length === 0) throw new Error("Message not found.");
  const authorId = String(rs.rows[0].discord_id);
  if (authorId !== actorId && club.ownerId !== actorId) {
    throw new Error("You can only delete your own messages.");
  }
  await client.execute({
    sql: "DELETE FROM web_club_chat WHERE id = ? AND club_id = ?",
    args: [messageId, clubId],
  });
}
