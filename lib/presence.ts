/**
 * Website presence: who has the site open right now.
 *
 * Every signed-in tab sends a heartbeat (POST /api/presence) about once a
 * minute while it's visible. A player is "online" if one of their tabs checked
 * in within ONLINE_WINDOW_MS, which absorbs a missed beat or a slow network.
 * Closing the last tab sends a best-effort "leave" so they drop off at once.
 */

import { client } from "@/lib/db";

export const HEARTBEAT_MS = 60_000;
export const ONLINE_WINDOW_MS = 150_000;
const MAX_LOOKUP = 100;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_presence (
           discord_id TEXT PRIMARY KEY,
           player_name TEXT,
           last_seen INTEGER NOT NULL
         )`
      );
      await client
        .execute("CREATE INDEX IF NOT EXISTS idx_web_presence_player ON web_presence (player_name)")
        .catch(() => undefined);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/** Record a heartbeat (or, with `leave`, mark this user offline now). */
export async function touchPresence(
  discordId: string,
  playerName: string | null,
  leave = false
): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `INSERT INTO web_presence (discord_id, player_name, last_seen) VALUES (?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            player_name = COALESCE(excluded.player_name, web_presence.player_name),
            last_seen = excluded.last_seen`,
    args: [discordId, playerName, leave ? 0 : Date.now()],
  });
}

function clean(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).slice(0, MAX_LOOKUP);
}

/** Which of these player names / Discord ids are online right now. */
export async function getOnline(query: {
  names?: string[];
  ids?: string[];
}): Promise<{ names: string[]; ids: string[] }> {
  const names = clean(query.names ?? []);
  const ids = clean(query.ids ?? []);
  if (names.length === 0 && ids.length === 0) return { names: [], ids: [] };
  await ensureSchema();
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const where: string[] = [];
  const args: (string | number)[] = [cutoff];
  if (names.length > 0) {
    where.push(`player_name IN (${names.map(() => "?").join(",")})`);
    args.push(...names);
  }
  if (ids.length > 0) {
    where.push(`discord_id IN (${ids.map(() => "?").join(",")})`);
    args.push(...ids);
  }
  const rs = await client.execute({
    sql: `SELECT discord_id, player_name FROM web_presence
          WHERE last_seen >= ? AND (${where.join(" OR ")})`,
    args,
  });
  const wantNames = new Set(names);
  const wantIds = new Set(ids);
  const onlineNames = new Set<string>();
  const onlineIds = new Set<string>();
  for (const row of rs.rows) {
    const id = String(row.discord_id);
    const name = row.player_name == null ? null : String(row.player_name);
    if (wantIds.has(id)) onlineIds.add(id);
    if (name && wantNames.has(name)) onlineNames.add(name);
  }
  return { names: Array.from(onlineNames), ids: Array.from(onlineIds) };
}
