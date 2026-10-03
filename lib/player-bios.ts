/**
 * Profile bios (docs/PROFILE_UI_PLAN.md, Q2): a short "About" line a player
 * writes in Settings and everyone sees on their profile. Website-owned table,
 * keyed by players.id, so the bot's schema doesn't change.
 */
import { client } from "@/lib/db";
import { schemaOnce } from "@/lib/schema-once";
import { containsProfanity } from "@/lib/content-moderation";

export const BIO_MAX_LENGTH = 160;

let schemaReady: Promise<void> | null = null;

export function ensureBioSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = schemaOnce("player_bios", async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS player_bios (
          player_id INTEGER PRIMARY KEY,
          bio TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      );
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/**
 * The text as it will be stored: control characters dropped, spaces collapsed,
 * at most two lines in a row kept, trimmed.
 */
export function normalizeBio(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Why a bio can't be saved, or null when it can (after normalizeBio). */
export function bioError(bio: string): string | null {
  if (bio.length > BIO_MAX_LENGTH) return `Keep it to ${BIO_MAX_LENGTH} characters.`;
  if (containsProfanity(bio)) return "Your bio contains language that isn't allowed.";
  return null;
}

export async function getBio(playerId: number): Promise<string | null> {
  try {
    await ensureBioSchema();
    const rs = await client.execute({
      sql: "SELECT bio FROM player_bios WHERE player_id = ?",
      args: [playerId],
    });
    const bio = rs.rows[0]?.bio;
    return bio == null || bio === "" ? null : String(bio);
  } catch {
    return null;
  }
}

/** Save a normalized, checked bio; an empty one deletes it. */
export async function setBio(playerId: number, bio: string): Promise<void> {
  await ensureBioSchema();
  if (!bio) {
    await client.execute({ sql: "DELETE FROM player_bios WHERE player_id = ?", args: [playerId] });
    return;
  }
  await client.execute({
    sql: `INSERT INTO player_bios (player_id, bio, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(player_id) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at`,
    args: [playerId, bio, Date.now()],
  });
}
