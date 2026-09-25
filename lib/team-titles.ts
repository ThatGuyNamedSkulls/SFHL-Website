/**
 * Team titles — trophies Match Staff award with the bot's /awardtitle.
 * The bot writes team_titles; the website only reads it.
 */
import { client } from "@/lib/db";
import { schemaOnce } from "@/lib/schema-once";

export interface TeamTitle {
  id: number;
  title: string;
  awardedBy: string | null;
  awardedAt: number;
}

let schemaReady: Promise<void> | null = null;

/** Same definition as core/team_titles.py, so a fresh DB works either way. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = schemaOnce("team_titles", async () => {
      // One round trip (Turso is remote).
      await client.batch(
        [
          `CREATE TABLE IF NOT EXISTS team_titles (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             team_id TEXT NOT NULL,
             title TEXT NOT NULL,
             awarded_by TEXT,
             awarded_by_id TEXT,
             awarded_at INTEGER NOT NULL
           )`,
          "CREATE INDEX IF NOT EXISTS idx_team_titles_team ON team_titles (team_id)",
        ],
        "write"
      );
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/** Title count per team id (teams without titles are absent → 0). */
export async function titleCounts(teamIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(teamIds)].filter(Boolean);
  if (ids.length === 0) return out;
  await ensureSchema();
  const rs = await client.execute({
    sql: `SELECT team_id, COUNT(*) AS n FROM team_titles
          WHERE team_id IN (${ids.map(() => "?").join(",")})
          GROUP BY team_id`,
    args: ids,
  });
  for (const row of rs.rows) out.set(String(row.team_id), Number(row.n));
  return out;
}

/** A team's titles, newest first. */
export async function titlesForTeam(teamId: string): Promise<TeamTitle[]> {
  await ensureSchema();
  const rs = await client.execute({
    sql: `SELECT id, title, awarded_by, awarded_at FROM team_titles
          WHERE team_id = ? ORDER BY awarded_at DESC, id DESC`,
    args: [teamId],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    awardedBy: r.awarded_by == null ? null : String(r.awarded_by),
    awardedAt: Number(r.awarded_at),
  }));
}
