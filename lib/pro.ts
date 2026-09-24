/**
 * Pro Matchmaking access (mirrors the bot's core/pro.py): S2+ players —
 * access at 1900 main Elo, kept until it drops below 1850. The bot keeps
 * `players.pro_access` up to date; the website only reads it.
 */
import { client } from "@/lib/db";

export const PRO_MIN_ELO = 1900;
export const PRO_KEEP_ELO = 1850;
export const PRO_LADDER = "pro";

export function proAccessAfter(elo: number, placementDone: boolean, hadAccess: boolean): boolean {
  if (!placementDone) return false;
  if (elo >= PRO_MIN_ELO) return true;
  if (elo < PRO_KEEP_ELO) return false;
  return hadAccess;
}

/** Pro access for these Discord users (unknown users -> false). */
export async function proAccessByDiscordId(discordIds: string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(discordIds.filter(Boolean))];
  const out = new Map<string, boolean>(ids.map((id) => [id, false]));
  if (ids.length === 0) return out;
  const marks = ids.map(() => "?").join(",");
  let rows: Record<string, unknown>[];
  try {
    const rs = await client.execute({
      sql: `SELECT discord_id, elo, placement_done, COALESCE(pro_access, 0) AS pro_access
            FROM players WHERE discord_id IN (${marks})`,
      args: ids,
    });
    rows = rs.rows as unknown as Record<string, unknown>[];
  } catch {
    // pro_access column not added yet (bot not restarted): the 1900 rule alone.
    const rs = await client.execute({
      sql: `SELECT discord_id, elo, placement_done, 0 AS pro_access
            FROM players WHERE discord_id IN (${marks})`,
      args: ids,
    });
    rows = rs.rows as unknown as Record<string, unknown>[];
  }
  for (const r of rows) {
    out.set(
      String(r.discord_id),
      proAccessAfter(Number(r.elo ?? 0), Number(r.placement_done) === 1, Number(r.pro_access) === 1)
    );
  }
  return out;
}

export async function hasProAccess(discordId: string): Promise<boolean> {
  return (await proAccessByDiscordId([discordId])).get(discordId) ?? false;
}
