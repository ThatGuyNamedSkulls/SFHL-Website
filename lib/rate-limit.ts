/**
 * Fixed-window rate limits shared by every serverless instance (a Turso table,
 * one upsert per check) — docs/WEBSITE_SECURITY_PLAN.md 1.2, Q2.
 *
 * Only used on writes, which are rare next to reads, so the extra round trip
 * is cheap. Keys look like `chat:<discordId>` or `invite:<from>:<to>`.
 */
import { NextResponse } from "next/server";
import { client } from "@/lib/db";
import { schemaOnce } from "@/lib/schema-once";

const ensureTable = schemaOnce("rate_limits", async () => {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS web_rate_limits (
       key TEXT PRIMARY KEY,
       count INTEGER NOT NULL,
       window_start INTEGER NOT NULL
     )`
  );
});

const DAY_MS = 24 * 60 * 60_000;

/** Count one hit on `key`; true while the key is within `limit` hits per `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const rs = await client.execute({
    sql: `INSERT INTO web_rate_limits (key, count, window_start) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
            window_start = excluded.window_start
          RETURNING count`,
    args: [key, windowStart],
  });
  // Old windows are dead weight; sweep them now and then.
  if (Math.random() < 0.01) {
    client
      .execute({ sql: "DELETE FROM web_rate_limits WHERE window_start < ?", args: [now - DAY_MS] })
      .catch(() => undefined);
  }
  return Number(rs.rows[0]?.count ?? 0) <= limit;
}

/** Limits used by the API routes (per Discord account unless noted). */
export const LIMITS = {
  chat: { limit: 20, windowMs: 60_000 },
  partyCreate: { limit: 5, windowMs: 10 * 60_000 },
  invite: { limit: 10, windowMs: 10 * 60_000 },
  /** Same inviter → same invitee, across all parties. */
  invitePair: { limit: 1, windowMs: 10 * 60_000 },
  friendRequest: { limit: 10, windowMs: 10 * 60_000 },
  guestbook: { limit: 5, windowMs: 10 * 60_000 },
  /** Saving your profile bio. */
  profileEdit: { limit: 10, windowMs: 10 * 60_000 },
  groupWrite: { limit: 60, windowMs: 10 * 60_000 },
  shop: { limit: 20, windowMs: 60_000 },
  general: { limit: 60, windowMs: 60_000 },
  /** Reporting a player (app/api/reports). */
  report: { limit: 5, windowMs: 60 * 60_000 },
  /** Staff panel actions sent to the bot (app/api/staff/jobs). */
  staffAction: { limit: 30, windowMs: 60_000 },
} as const;

/**
 * For routes: null when allowed, else a ready 429 response. Fails open on a
 * database error — a broken limiter must not take the site down.
 */
export async function limited(
  key: string,
  rule: { limit: number; windowMs: number },
  message = "You're doing that too often. Please wait a moment."
): Promise<NextResponse | null> {
  try {
    if (await rateLimit(key, rule.limit, rule.windowMs)) return null;
  } catch (error) {
    console.error("rate limit check failed", error);
    return null;
  }
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(Math.ceil(rule.windowMs / 1000)) } }
  );
}
