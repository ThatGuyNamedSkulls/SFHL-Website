import { client } from "@/lib/db";

export interface GuestbookEntry {
  id: number;
  profileName: string;
  fromName: string;
  message: string;
  createdAt: number;
}

let schemaReady: Promise<void> | null = null;

export function ensureGuestbookSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = client
      .execute(
        `CREATE TABLE IF NOT EXISTS guestbook (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_name TEXT NOT NULL,
          from_name TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      )
      .then(() => undefined)
      .catch(() => undefined);
  }
  return schemaReady;
}

export async function listGuestbook(profileName: string): Promise<GuestbookEntry[]> {
  await ensureGuestbookSchema();
  const rs = await client.execute({
    sql: "SELECT id, profile_name, from_name, message, created_at FROM guestbook WHERE profile_name = ? ORDER BY created_at DESC LIMIT 50",
    args: [profileName],
  });
  return rs.rows.map((row) => ({
    id: Number(row.id),
    profileName: String(row.profile_name),
    fromName: String(row.from_name),
    message: String(row.message),
    createdAt: Number(row.created_at),
  }));
}

export async function addGuestbookEntry(
  profileName: string,
  fromName: string,
  message: string
): Promise<GuestbookEntry> {
  await ensureGuestbookSchema();
  const createdAt = Date.now();
  const rs = await client.execute({
    sql: "INSERT INTO guestbook (profile_name, from_name, message, created_at) VALUES (?, ?, ?, ?)",
    args: [profileName, fromName, message, createdAt],
  });
  return {
    id: Number(rs.lastInsertRowid ?? 0),
    profileName,
    fromName,
    message,
    createdAt,
  };
}
