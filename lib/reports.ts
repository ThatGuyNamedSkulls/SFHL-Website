/**
 * Player reports from the website — the same `reports` table /mod report
 * writes in Discord, read by staff in the staff panel's Moderation tab (and
 * /mod reports). Staff mark them handled there.
 *
 * The table is the bot's (core/schema.py); this mirrors its DDL and the
 * columns added later, so a fresh database works from either side.
 */
import { client } from "@/lib/db";
import { ddlBatch, missingColumns, schemaOnce } from "@/lib/schema-once";

export const REPORT_REASON_MIN = 5;
export const REPORT_REASON_MAX = 500;
/** One report per reporter per reported player in this window. */
const REPEAT_WINDOW_MS = 10 * 60_000;

export class ReportError extends Error {}

export const ensureReportsSchema = schemaOnce("reports", async () => {
  await ddlBatch([
    `CREATE TABLE IF NOT EXISTS reports (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       reporter_name TEXT NOT NULL,
       reported_player TEXT NOT NULL,
       reason TEXT NOT NULL,
       timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
     )`,
  ]);
  const missing = await missingColumns({
    reports: ["reporter_player_id", "reported_player_id", "handled_at", "handled_by", "source"],
  });
  const types: Record<string, string> = {
    reporter_player_id: "INTEGER",
    reported_player_id: "INTEGER",
    handled_at: "INTEGER",
    handled_by: "TEXT",
    source: "TEXT DEFAULT 'discord'",
  };
  await ddlBatch(missing.reports.map((c) => `ALTER TABLE reports ADD COLUMN ${c} ${types[c]}`));
  await ddlBatch([
    "CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_player)",
    "CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_name)",
  ]);
});

export interface Reporter {
  discordId: string;
  /** Player name if they have one, else their Discord name (what /mod report stores). */
  name: string;
}

/** File a report on a player. Throws ReportError with a message fit to show. */
export async function createReport(reporter: Reporter, reportedName: string, rawReason: string): Promise<{ reported: string }> {
  const reason = String(rawReason ?? "").trim().replace(/\s+\n/g, "\n");
  if (reason.length < REPORT_REASON_MIN) throw new ReportError("Say what happened (a few words at least).");
  if (reason.length > REPORT_REASON_MAX) throw new ReportError(`Keep it under ${REPORT_REASON_MAX} characters.`);
  await ensureReportsSchema();

  const [target, me] = await Promise.all([
    client.execute({
      sql: "SELECT id, name, CAST(discord_id AS TEXT) AS did FROM players WHERE name = ? LIMIT 1",
      args: [String(reportedName ?? "").trim()],
    }),
    client.execute({
      sql: "SELECT id, name FROM players WHERE discord_id = ? LIMIT 1",
      args: [reporter.discordId],
    }),
  ]);
  const reported = target.rows[0] as unknown as { id: number; name: string; did: string | null } | undefined;
  if (!reported) throw new ReportError("That player doesn't exist.");
  const mine = me.rows[0] as unknown as { id: number; name: string } | undefined;
  if (String(reported.did ?? "") === reporter.discordId || (mine && Number(mine.id) === Number(reported.id))) {
    throw new ReportError("You can't report yourself.");
  }
  const reporterName = mine ? String(mine.name) : reporter.name;

  const recent = await client.execute({
    sql: `SELECT 1 FROM reports
           WHERE reported_player = ? AND (reporter_name = ? OR reporter_player_id = ?)
             AND timestamp >= ? LIMIT 1`,
    args: [
      String(reported.name),
      reporterName,
      mine ? Number(mine.id) : -1,
      new Date(Date.now() - REPEAT_WINDOW_MS).toISOString().slice(0, 19).replace("T", " "),
    ],
  });
  if (recent.rows.length) throw new ReportError(`You already reported ${reported.name} just now. Staff will look at it.`);

  await client.execute({
    sql: `INSERT INTO reports (reporter_name, reporter_player_id, reported_player, reported_player_id, reason, source)
          VALUES (?, ?, ?, ?, ?, 'website')`,
    args: [reporterName, mine ? Number(mine.id) : null, String(reported.name), Number(reported.id), reason],
  });
  return { reported: String(reported.name) };
}

/** Staff: mark a report handled (or open again). False when there's no such report. */
export async function setReportHandled(id: number, handled: boolean, by: string): Promise<boolean> {
  await ensureReportsSchema();
  const rs = await client.execute({
    sql: "UPDATE reports SET handled_at = ?, handled_by = ? WHERE id = ?",
    args: handled ? [Date.now(), by.slice(0, 64), id] : [null, null, id],
  });
  return rs.rowsAffected > 0;
}
