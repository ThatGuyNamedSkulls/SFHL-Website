/**
 * The badge next to a player's name: only the highest one they have is shown.
 *
 *   Mod Pin  — Match Staff (players.match_staff, synced hourly by the bot)
 *   Top 10   — the bot's Top 10: highest Elo (> 0), then most wins
 *   Equipped — the first badge the player equipped from their inventory
 *              (earliest equipped_at); it takes Verified's place
 *   Verified — Matchmaking access (players.mm_access), shown by the caller
 *
 * One cached lookup (a minute) serves every name on a page. Equipping or
 * unequipping a badge clears it (forgetNameBadges), so the change shows at once.
 */
import { client, ensurePlayerDiscordColumns } from "@/lib/db";
import { forget, remember } from "@/lib/server-cache";
import type { EquippedNameBadge, NameBadgeValue } from "@/types";

/** Same size as the bot's TOP10_COUNT (config/settings.py). */
const TOP10_COUNT = 10;
const CACHE_KEY = "name-badges";

export interface BadgeIndex {
  staff: Set<string>;
  top10: Set<string>;
  /** First equipped badge per player key. */
  equipped: Map<string, EquippedNameBadge>;
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
  return remember(CACHE_KEY, 60_000, async () => {
    const index: BadgeIndex = { staff: new Set(), top10: new Set(), equipped: new Map() };
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
    try {
      // Oldest equip first, so the first badge a player equipped claims their key.
      const equipped = await client.execute(
        `SELECT COALESCE(p.name, inv.player_name) AS name, CAST(p.discord_id AS TEXT) AS did,
                i.name AS badge, i.asset AS asset
         FROM cosmetic_inventory inv
         JOIN cosmetic_items i ON i.id = inv.item_id
         LEFT JOIN players p ON p.id = inv.player_id
         WHERE inv.equipped = 1 AND i.type = 'badge'
         ORDER BY COALESCE(inv.equipped_at, 0) ASC, inv.id ASC`
      );
      for (const row of equipped.rows as unknown as Record<string, unknown>[]) {
        const badge: EquippedNameBadge = {
          name: String(row.badge ?? ""),
          asset: row.asset == null || row.asset === "" ? null : String(row.asset),
        };
        for (const key of keysOf(row)) {
          if (!index.equipped.has(key)) index.equipped.set(key, badge);
        }
      }
    } catch {
      /* cosmetics tables not created yet: no equipped badges */
    }
    return index;
  });
}

/** Drop the cached index (after a badge is equipped or unequipped). */
export function forgetNameBadges(): void {
  forget(CACHE_KEY);
}

/** The badge this player shows instead of Verified, or null. */
export function nameBadgeFor(
  index: BadgeIndex,
  who: { discordId?: string | null; playerName?: string | null }
): NameBadgeValue | null {
  const keys = [
    ...(who.discordId ? [idKey(String(who.discordId))] : []),
    ...(who.playerName ? [nameKey(who.playerName)] : []),
  ];
  if (keys.some((k) => index.staff.has(k))) return "staff";
  if (keys.some((k) => index.top10.has(k))) return "top10";
  for (const k of keys) {
    const badge = index.equipped.get(k);
    if (badge) return badge;
  }
  return null;
}
