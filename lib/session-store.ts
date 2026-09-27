/**
 * Server-side session state (docs/WEBSITE_SECURITY_PLAN.md 1.3):
 *
 * - `web_session_epochs`: a per-account counter baked into every session JWT.
 *   Bumping it ("log out everywhere") makes every older cookie invalid.
 * - The live player link: the player row is looked up by discord_id on each
 *   request, so a rename / unlink / removal takes effect at once instead of
 *   riding along in a JWT for days.
 *
 * Both are cached per instance for a few seconds (every poll would otherwise
 * add a round trip). Kept free of other lib imports so lib/auth can use it.
 */
import { client } from "@/lib/db";
import { schemaOnce } from "@/lib/schema-once";
import { forget, remember } from "@/lib/server-cache";

const ensureTable = schemaOnce("session_epochs", async () => {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS web_session_epochs (
       discord_id TEXT PRIMARY KEY,
       epoch INTEGER NOT NULL DEFAULT 0
     )`
  );
});

const LIVE_TTL_MS = 30_000;

export interface LiveIdentity {
  /** The linked player's current name (null when this account isn't linked). */
  playerName: string | null;
  epoch: number;
}

const cacheKey = (discordId: string) => `live-identity:${discordId}`;

/** Current player link + session epoch for an account (cached ~30 s). */
export function liveIdentity(discordId: string): Promise<LiveIdentity> {
  return remember(cacheKey(discordId), LIVE_TTL_MS, async () => {
    await ensureTable();
    const rs = await client.execute({
      sql: `SELECT (SELECT name FROM players WHERE discord_id = ? LIMIT 1) AS name,
                   (SELECT epoch FROM web_session_epochs WHERE discord_id = ?) AS epoch`,
      args: [discordId, discordId],
    });
    const row = rs.rows[0];
    return {
      playerName: row?.name == null ? null : String(row.name),
      epoch: Number(row?.epoch ?? 0) || 0,
    };
  });
}

/** Invalidate every existing session of this account. */
export async function bumpSessionEpoch(discordId: string): Promise<void> {
  await ensureTable();
  await client.execute({
    sql: `INSERT INTO web_session_epochs (discord_id, epoch) VALUES (?, 1)
          ON CONFLICT(discord_id) DO UPDATE SET epoch = epoch + 1`,
    args: [discordId],
  });
  forget(cacheKey(discordId));
}

/** Drop the cached identity (e.g. right after login). */
export function forgetLiveIdentity(discordId: string) {
  forget(cacheKey(discordId));
}
