/**
 * The staff panel's Moderation tab (CBL bot docs/STAFF_PANEL_PLAN.md step 4):
 * player reports, recent timeouts, early leaves and who is suspended from
 * matchmaking right now — across every player, read straight from the bot's
 * tables (the website only reads them; /mod timeout etc. live in the Players
 * tab). The same data as /mod reports · timeouts · leaves.
 *
 * Times: SQLite CURRENT_TIMESTAMP text ("YYYY-MM-DD HH:MM:SS", UTC). A
 * timeout's end is its start + its length: timeouts.expiry_time is written
 * from the bot host's local clock and isn't reliable.
 */
import { client } from "@/lib/db";
import { ensureReportsSchema } from "@/lib/reports";

const REPORTS = 100;
const RECENT = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ModReport {
  id: number;
  reporter: string;
  reported: string;
  /** The reported name is a player (so it can be opened in the Players tab). */
  reportedIsPlayer: boolean;
  reason: string;
  at: number;
  /** "website" or "discord" (/mod report). */
  source: string;
  handledAt: number | null;
  handledBy: string | null;
}

interface WhoRow {
  discordId: string;
  /** Their name when it happened (Discord display name). */
  name: string;
  /** Their player name today, if they have an account. */
  player: string | null;
}

export interface ModTimeout extends WhoRow {
  id: number;
  reason: string;
  minutes: number;
  moderator: string;
  at: number;
  endsAt: number;
  active: boolean;
}

export interface ModLeave extends WhoRow {
  id: number;
  eloPenalty: number;
  /** Which leave this was within the bot's counting window (#1, #2…). */
  count: number;
  at: number;
}

export interface ModSuspension extends WhoRow {
  id: number;
  reason: string;
  startedAt: number;
  endsAt: number;
}

export interface StaffModerationView {
  reports: ModReport[];
  timeouts: ModTimeout[];
  leaves: ModLeave[];
  suspended: ModSuspension[];
  counts: { suspendedNow: number; timedOutNow: number; reportsThisWeek: number; openReports: number };
}

type Row = Record<string, unknown>;

async function rows(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try {
    return (await client.execute({ sql, args })).rows as unknown as Row[];
  } catch {
    return []; // the bot hasn't created this table yet
  }
}

/** SQLite UTC text → epoch ms (0 if unreadable). */
export function utcMs(raw: unknown): number {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const ms = Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Epoch ms → the SQLite UTC text the bot writes ("YYYY-MM-DD HH:MM:SS"). */
function utcText(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

const str = (v: unknown) => (v == null ? "" : String(v));

export async function staffModerationView(now = Date.now()): Promise<StaffModerationView> {
  // The handled / source columns may be newer than the bot running against this DB.
  await ensureReportsSchema().catch(() => undefined);
  const [reports, openCount, timeouts, leaves, suspended] = await Promise.all([
    rows(
      `SELECT id, reporter_name, reported_player, reason, timestamp, handled_at, handled_by,
              COALESCE(source, 'discord') AS source
         FROM reports ORDER BY id DESC LIMIT ?`,
      [REPORTS]
    ),
    rows("SELECT COUNT(*) AS n FROM reports WHERE handled_at IS NULL"),
    rows(
      `SELECT id, discord_id, user_name, reason, duration_minutes, moderator_name, timestamp
         FROM timeouts ORDER BY id DESC LIMIT ?`,
      [RECENT]
    ),
    rows(
      `SELECT id, discord_id, user_name, elo_penalty, incident_count, timestamp
         FROM leaving_incidents ORDER BY id DESC LIMIT ?`,
      [RECENT]
    ),
    rows(
      `SELECT id, discord_id, user_name, reason, started_at, expires_at FROM suspensions
        WHERE lifted = 0 AND expires_at > ? ORDER BY expires_at`,
      [utcText(now)]
    ),
  ]);

  // Discord id → today's player name, and which reported names are players.
  const ids = [...new Set([...timeouts, ...leaves, ...suspended].map((r) => str(r.discord_id)).filter(Boolean))];
  const reportedNames = [...new Set(reports.map((r) => str(r.reported_player)).filter(Boolean))];
  const [byId, named] = await Promise.all([
    ids.length
      ? rows(
          `SELECT CAST(discord_id AS TEXT) AS did, name FROM players WHERE discord_id IN (${ids.map(() => "?").join(", ")})`,
          ids
        )
      : Promise.resolve([]),
    reportedNames.length
      ? rows(`SELECT name FROM players WHERE name IN (${reportedNames.map(() => "?").join(", ")})`, reportedNames)
      : Promise.resolve([]),
  ]);
  const playerOf = new Map(byId.map((r) => [str(r.did), str(r.name)]));
  const players = new Set(named.map((r) => str(r.name)));
  const who = (r: Row): WhoRow => ({
    discordId: str(r.discord_id),
    name: str(r.user_name),
    player: playerOf.get(str(r.discord_id)) ?? null,
  });

  const timeoutList: ModTimeout[] = timeouts.map((t) => {
    const at = utcMs(t.timestamp);
    const minutes = Number(t.duration_minutes) || 0;
    const endsAt = at + minutes * 60_000;
    return {
      ...who(t),
      id: Number(t.id),
      reason: str(t.reason),
      minutes,
      moderator: str(t.moderator_name),
      at,
      endsAt,
      active: at > 0 && endsAt > now,
    };
  });
  const reportList: ModReport[] = reports.map((r) => ({
    id: Number(r.id),
    reporter: str(r.reporter_name),
    reported: str(r.reported_player),
    reportedIsPlayer: players.has(str(r.reported_player)),
    reason: str(r.reason),
    at: utcMs(r.timestamp),
    source: str(r.source) || "discord",
    handledAt: r.handled_at == null ? null : Number(r.handled_at),
    handledBy: r.handled_by == null ? null : str(r.handled_by),
  }));

  return {
    reports: reportList,
    timeouts: timeoutList,
    leaves: leaves.map((l) => ({
      ...who(l),
      id: Number(l.id),
      eloPenalty: Number(l.elo_penalty) || 0,
      count: Number(l.incident_count) || 0,
      at: utcMs(l.timestamp),
    })),
    suspended: suspended.map((s) => ({
      ...who(s),
      id: Number(s.id),
      reason: str(s.reason),
      startedAt: utcMs(s.started_at),
      endsAt: utcMs(s.expires_at),
    })),
    counts: {
      suspendedNow: suspended.length,
      timedOutNow: new Set(timeoutList.filter((t) => t.active).map((t) => t.discordId)).size,
      reportsThisWeek: reportList.filter((r) => r.at > now - WEEK_MS).length,
      openReports: Number(openCount[0]?.n) || 0,
    },
  };
}
