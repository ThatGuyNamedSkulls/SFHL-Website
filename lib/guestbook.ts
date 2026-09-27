import { client, mapRank } from "@/lib/db";
import { schemaOnce } from "@/lib/schema-once";

export interface GuestbookEntry {
  id: number;
  profileName: string;
  fromName: string;
  message: string;
  createdAt: number;
  rank: string;
}

let schemaReady: Promise<void> | null = null;

export function ensureGuestbookSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = schemaOnce("guestbook", async () => {
      await client
        .execute(
          `CREATE TABLE IF NOT EXISTS guestbook (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_name TEXT NOT NULL,
            from_name TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )`
        )
        .catch(() => undefined);
      // player_id columns (Phase 1 of the players(name) -> players(id) FK
      // migration; see docs/DATABASE_PK_FK_RELATIONSHIPS.docx). Not used to
      // read here — listGuestbook/authorRank deliberately match case-
      // insensitively (lower(name)), which a strict id lookup can't
      // replicate — but dual-written so they're ready once that's revisited.
      await client
        .execute("ALTER TABLE guestbook ADD COLUMN profile_player_id INTEGER")
        .catch(() => undefined);
      await client
        .execute("ALTER TABLE guestbook ADD COLUMN from_player_id INTEGER")
        .catch(() => undefined);
    })();
  }
  return schemaReady;
}

export async function listGuestbook(profileName: string): Promise<GuestbookEntry[]> {
  await ensureGuestbookSchema();
  const rs = await client.execute({
    sql: `SELECT g.id, g.profile_name, g.from_name, g.message, g.created_at, p.rank
          FROM guestbook g
          LEFT JOIN players p ON lower(p.name) = lower(g.from_name)
          WHERE g.profile_name = ?
          ORDER BY g.created_at DESC
          LIMIT 50`,
    args: [profileName],
  });
  return rs.rows.map((row) => ({
    id: Number(row.id),
    profileName: String(row.profile_name),
    fromName: String(row.from_name),
    message: String(row.message),
    createdAt: Number(row.created_at),
    rank: mapRank(row.rank == null ? "" : String(row.rank)),
  }));
}

async function authorRank(fromName: string): Promise<string> {
  try {
    const rs = await client.execute({
      sql: "SELECT rank, placement_done FROM players WHERE lower(name) = lower(?) LIMIT 1",
      args: [fromName],
    });
    if (Number(rs.rows[0]?.placement_done) !== 1) return "UNRANKED";
    const rank = rs.rows[0]?.rank;
    return mapRank(rank != null ? String(rank) : "");
  } catch {
    return "UNRANKED";
  }
}

export async function addGuestbookEntry(
  profileName: string,
  fromName: string,
  message: string
): Promise<GuestbookEntry> {
  await ensureGuestbookSchema();
  const createdAt = Date.now();
  const rs = await client.execute({
    sql: `INSERT INTO guestbook
              (profile_name, from_name, profile_player_id, from_player_id, message, created_at)
          VALUES (?, ?, (SELECT id FROM players WHERE lower(name) = lower(?)),
                  (SELECT id FROM players WHERE lower(name) = lower(?)), ?, ?)`,
    args: [profileName, fromName, profileName, fromName, message, createdAt],
  });
  return {
    id: Number(rs.lastInsertRowid ?? 0),
    profileName,
    fromName,
    message,
    createdAt,
    rank: await authorRank(fromName),
  };
}

/** The exact stored name of a player (case-insensitive lookup), or null. */
export async function canonicalPlayerName(name: string): Promise<string | null> {
  const rs = await client.execute({
    sql: "SELECT name FROM players WHERE lower(name) = lower(?) LIMIT 1",
    args: [name.trim()],
  });
  return rs.rows[0]?.name == null ? null : String(rs.rows[0].name);
}

/**
 * Delete one entry. Allowed for the profile owner, the author, or Match Staff
 * (security report L5). Returns false when the entry doesn't exist.
 */
export async function deleteGuestbookEntry(
  id: number,
  actor: { playerName: string | null; staff: boolean }
): Promise<boolean> {
  await ensureGuestbookSchema();
  const rs = await client.execute({
    sql: "SELECT profile_name, from_name FROM guestbook WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return false;
  const me = (actor.playerName || "").toLowerCase();
  const allowed =
    actor.staff ||
    (!!me && (String(row.profile_name).toLowerCase() === me || String(row.from_name).toLowerCase() === me));
  if (!allowed) throw new Error("You can only delete messages on your own profile or that you wrote.");
  await client.execute({ sql: "DELETE FROM guestbook WHERE id = ?", args: [id] });
  return true;
}
