/**
 * Permanent matchmaking bans, set with /player ban in the CBL bot (its
 * core/bans.py and the player_bans table). A banned Discord account can't
 * queue or claim a sub slot here either; it isn't a Discord ban.
 */
import { client } from "@/lib/db";

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
