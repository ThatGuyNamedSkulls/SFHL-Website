/**
 * The badge next to a player's name: only the highest one they have is shown.
 *
 *   Mod Pin  — Match Staff (players.match_staff, synced hourly by the bot)
 *   Top 10   — the bot's Top 10: highest Elo (> 0), then most wins
 *   Verified — Matchmaking access (players.mm_access), shown by the caller
 *
 * One cached lookup (a minute) serves every name on a page.
 */
import { client, ensurePlayerDiscordColumns } from "@/lib/db";
import { remember } from "@/lib/server-cache";

export type NameBadgeTier = "staff" | "top10";

/** Same size as the bot's TOP10_COUNT (config/settings.py). */
const TOP10_COUNT = 10;

export interface BadgeIndex {
  staff: Set<string>;
  top10: Set<string>;
}

const idKey = (discordId: string) => `id:${discordId}`;
const nameKey = (name: string) => `name:${name.toLowerCase()}`;

function keysOf(row: Record<string, unknown>): string[] {
  const keys = [nameKey(String(row.name ?? ""))];
  const did = row.did == null ? "" : String(row.did);
  if (did && did !== "0") keys.push(idKey(did));
  return keys;
}

export function badgeIndex(): Promise<BadgeIndex> {
  return remember("name-badges", 60_000, async () => {
    const index: BadgeIndex = { staff: new Set(), top10: new Set() };
    try {
      await ensurePlayerDiscordColumns();
      const [top, staff] = await client.batch(
        [
          {
            sql: `SELECT name, CAST(discord_id AS TEXT) AS did, elo FROM players
                  ORDER BY elo DESC, matches_won DESC LIMIT ?`,
            args: [TOP10_COUNT],
          },
          "SELECT name, CAST(discord_id AS TEXT) AS did FROM players WHERE COALESCE(match_staff, 0) = 1",
        ],
        "read"
      );
      for (const row of top.rows as unknown as Record<string, unknown>[]) {
        if (Number(row.elo ?? 0) > 0) keysOf(row).forEach((k) => index.top10.add(k));
      }
      for (const row of staff.rows as unknown as Record<string, unknown>[]) {
        keysOf(row).forEach((k) => index.staff.add(k));
      }
    } catch {
      /* players table not ready: nobody gets a badge above Verified */
    }
    return index;
  });
}

/** The highest badge above Verified this player has, or null. */
export function nameBadgeFor(
  index: BadgeIndex,
  who: { discordId?: string | null; playerName?: string | null }
): NameBadgeTier | null {
  const keys = [
    ...(who.discordId ? [idKey(String(who.discordId))] : []),
    ...(who.playerName ? [nameKey(who.playerName)] : []),
  ];
  if (keys.some((k) => index.staff.has(k))) return "staff";
  if (keys.some((k) => index.top10.has(k))) return "top10";
  return null;
}
