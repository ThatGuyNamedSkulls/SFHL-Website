/**
 * Overtime tie votes in the website match room — the same vote as the
 * Discord one (/match overtimevote): it lives in the `overtime_votes` table
 * (CBL bot core/overtime_votes.py, same DDL), the bot follows website votes in
 * its Discord message and ends the vote early once it has passed.
 *
 * A vote is counted in one UPDATE (only a player of that match, once, while
 * the vote is open), the same statement the bot uses.
 */
import { client } from "@/lib/db";
import { ddlBatch, schemaOnce } from "@/lib/schema-once";

/** How long a finished vote's result stays on the match page. */
const SHOW_RESULT_MS = 10 * 60_000;

export type OvertimeVoteStatus = "open" | "tie" | "no_tie";

export interface OvertimeVoteView {
  id: number;
  overtime: number;
  required: number;
  yes: number;
  eligible: number;
  status: OvertimeVoteStatus;
  endsAt: number;
  /** This viewer is one of the match's players. */
  canVote: boolean;
  voted: boolean;
}

export class OvertimeVoteError extends Error {}

export const ensureOvertimeVotesTable = schemaOnce("overtime_votes", async () => {
  await ddlBatch([
    `CREATE TABLE IF NOT EXISTS overtime_votes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       lobby_id TEXT NOT NULL,
       overtime INTEGER NOT NULL,
       required INTEGER NOT NULL,
       eligible TEXT NOT NULL,
       yes TEXT NOT NULL DEFAULT '[]',
       status TEXT NOT NULL DEFAULT 'open',
       started_by TEXT,
       started_at INTEGER NOT NULL,
       ends_at INTEGER NOT NULL
     )`,
    "CREATE INDEX IF NOT EXISTS idx_overtime_votes_lobby ON overtime_votes (lobby_id, id)",
  ]);
});

type Row = Record<string, unknown>;

function list(raw: unknown): string[] {
  try {
    const value = JSON.parse(String(raw ?? "[]")) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

async function latest(lobbyId: string): Promise<Row | null> {
  await ensureOvertimeVotesTable();
  const rs = await client.execute({
    sql: `SELECT id, overtime, required, eligible, yes, status, started_at, ends_at
            FROM overtime_votes WHERE lobby_id = ? ORDER BY id DESC LIMIT 1`,
    args: [lobbyId],
  });
  return (rs.rows[0] as unknown as Row) ?? null;
}

export function voteView(row: Row, viewerId: string | null, now: number): OvertimeVoteView {
  const eligible = list(row.eligible);
  const yes = list(row.yes);
  const required = Number(row.required) || 0;
  let status = String(row.status) as OvertimeVoteStatus;
  const endsAt = Number(row.ends_at) || 0;
  // Time's up but the bot hasn't settled it yet: show what it will settle to.
  if (status === "open" && endsAt <= now) status = yes.length >= required ? "tie" : "no_tie";
  const voted = !!viewerId && yes.includes(viewerId);
  return {
    id: Number(row.id),
    overtime: Number(row.overtime) || 1,
    required,
    yes: yes.length,
    eligible: eligible.length,
    status,
    endsAt,
    canVote: !!viewerId && eligible.includes(viewerId),
    voted,
  };
}

/** The match's current vote (or one that ended in the last few minutes), for the match page. */
export async function overtimeVoteFor(lobbyId: string, viewerId: string | null, now = Date.now()): Promise<OvertimeVoteView | null> {
  const row = await latest(lobbyId);
  if (!row) return null;
  const view = voteView(row, viewerId, now);
  if (view.status !== "open" && Number(row.started_at) < now - SHOW_RESULT_MS) return null;
  return view;
}

/** Vote "tie" in this match's open vote. Throws OvertimeVoteError with a message fit to show. */
export async function voteTie(lobbyId: string, viewerId: string, now = Date.now()): Promise<OvertimeVoteView> {
  const row = await latest(lobbyId);
  if (!row || voteView(row, viewerId, now).status !== "open") throw new OvertimeVoteError("There's no tie vote open in this match.");
  const view = voteView(row, viewerId, now);
  if (!view.canVote) throw new OvertimeVoteError("Only this match's players can vote.");
  if (view.voted) throw new OvertimeVoteError("You already voted for a tie.");
  const id = Number(row.id);
  const rs = await client.execute({
    sql: `UPDATE overtime_votes SET yes = json_insert(yes, '$[#]', ?)
           WHERE id = ? AND status = 'open' AND ends_at > ?
             AND EXISTS (SELECT 1 FROM json_each(overtime_votes.eligible) WHERE value = ?)
             AND NOT EXISTS (SELECT 1 FROM json_each(overtime_votes.yes) WHERE value = ?)`,
    args: [viewerId, id, now, viewerId, viewerId],
  });
  if (rs.rowsAffected !== 1) throw new OvertimeVoteError("The vote just closed, or you already voted.");
  await client.execute({
    sql: "UPDATE overtime_votes SET status = 'tie' WHERE id = ? AND status = 'open' AND json_array_length(yes) >= required",
    args: [id],
  });
  return voteView((await latest(lobbyId)) as Row, viewerId, now);
}
