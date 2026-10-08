/**
 * Permanent matchmaking bans, set with /player ban in the CBL bot (its
 * core/bans.py and the player_bans table). A banned Discord account can't
 * queue or claim a sub slot here either; it isn't a Discord ban.
 */
import { client } from "@/lib/db";
import { remember } from "@/lib/server-cache";

/** How long the public "Banned" tags may lag a /player ban or unban. */
const SHOWN_BANS_TTL_MS = 30_000;

/** Bot times are UTC "YYYY-MM-DD HH:MM:SS"; null when unreadable. */
function utcIso(at: unknown): string | null {
  const text = String(at ?? "").trim();
  if (!text) return null;
  const d = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Every active ban for the public "Banned" tags (profile, leaderboard,
 * search): Discord id → when it started (ISO, or null if unreadable). The
 * table is small; cached briefly because the leaderboard and search ask on
 * every load. Not for enforcement: queueing and subs use bannedDiscordIds.
 */
export async function shownBans(): Promise<Map<string, string | null>> {
  return remember("bans:shown", SHOWN_BANS_TTL_MS, async () => {
    try {
      const rs = await client.execute(
        "SELECT discord_id, MIN(banned_at) AS since FROM player_bans WHERE lifted_at IS NULL GROUP BY discord_id"
      );
      return new Map(rs.rows.map((r) => [String(r.discord_id), utcIso(r.since)]));
    } catch {
      // No player_bans table yet (the bot creates it on start): nobody is banned.
      return new Map<string, string | null>();
    }
  });
}

/** Which of these Discord ids have an active ban. */
export async function bannedDiscordIds(ids: string[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Set();
  try {
    const rs = await client.execute({
      sql: `SELECT DISTINCT discord_id FROM player_bans
             WHERE lifted_at IS NULL AND discord_id IN (${list.map(() => "?").join(", ")})`,
      args: list,
    });
    return new Set(rs.rows.map((r) => String(r.discord_id)));
  } catch {
    // No player_bans table yet (the bot creates it on start). The bot's web
    // queue sync drops banned players too, so this can't let one through.
    return new Set();
  }
}

export async function isBanned(discordId: string): Promise<boolean> {
  return (await bannedDiscordIds([discordId])).has(String(discordId));
}
