/**
 * Cosmetics: profile cards, titles, and badge items (FACEIT-style inventory).
 *
 * The Discord bot owns the catalog and grant/revoke (core/cosmetics.py — the
 * schema below is mirrored there in core/schema.py); the website owns the
 * equip/unequip flow and rendering. Items are keyed to players by player name.
 *
 * Equipped state is a flag on the inventory row, so a bot-side revoke (DELETE)
 * atomically removes the equip too. Single-equip for card/title is enforced at
 * write time; badges allow up to MAX_EQUIPPED_BADGES equipped at once.
 *
 * The equipped title is mirrored into players.title so the bot's /checkplayer
 * embed keeps showing it.
 */

import { client } from "@/lib/db";

export type CosmeticType = "card" | "title" | "badge";

export interface InventoryItem {
  id: number; // catalog item id (what equip endpoints take)
  slug: string;
  type: CosmeticType;
  name: string;
  description: string;
  asset: string | null;
  category: string | null;
  season: string | null;
  rarity: string;
  grantedAt: number;
  equipped: boolean;
}

/** Equipped cosmetics as rendered on a public profile. */
export interface ProfileCosmetics {
  card: { slug: string; name: string; asset: string | null } | null;
  title: string | null;
  badges: { slug: string; name: string; description: string; asset: string | null }[];
}

export const MAX_EQUIPPED_BADGES = 5;

let schemaReady: Promise<void> | null = null;

/** Create the cosmetics tables once per process (idempotent, mirrors
 *  core/schema.py). Schema only — item seeding is bot-side. */
function ensureCosmeticsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.batch([
        `CREATE TABLE IF NOT EXISTS cosmetic_items (
           id          INTEGER PRIMARY KEY AUTOINCREMENT,
           slug        TEXT NOT NULL UNIQUE,
           type        TEXT NOT NULL,
           name        TEXT NOT NULL,
           description TEXT DEFAULT '',
           asset       TEXT DEFAULT NULL,
           category    TEXT DEFAULT NULL,
           season      TEXT DEFAULT NULL,
           rarity      TEXT DEFAULT 'common',
           created_at  INTEGER )`,
        `CREATE TABLE IF NOT EXISTS cosmetic_inventory (
           id          INTEGER PRIMARY KEY AUTOINCREMENT,
           player_name TEXT NOT NULL,
           item_id     INTEGER NOT NULL,
           granted_by  TEXT DEFAULT NULL,
           granted_at  INTEGER,
           equipped    INTEGER NOT NULL DEFAULT 0,
           equipped_at INTEGER )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_cosmetic_inventory_unique
           ON cosmetic_inventory(player_name, item_id)`,
        `CREATE INDEX IF NOT EXISTS idx_cosmetic_inventory_player
           ON cosmetic_inventory(player_name)`,
      ]);
    })();
  }
  return schemaReady;
}

function rowToItem(r: Record<string, unknown>): InventoryItem {
  return {
    id: Number(r.id),
    slug: r.slug as string,
    type: r.type as CosmeticType,
    name: r.name as string,
    description: (r.description as string) ?? "",
    asset: (r.asset as string) ?? null,
    category: (r.category as string) ?? null,
    season: (r.season as string) ?? null,
    rarity: (r.rarity as string) || "common",
    grantedAt: Number(r.granted_at ?? 0),
    equipped: Number(r.equipped) === 1,
  };
}

/** Everything the player owns, catalog details included. */
export async function getInventory(playerName: string): Promise<InventoryItem[]> {
  await ensureCosmeticsSchema();
  const rs = await client.execute({
    sql: `SELECT i.id, i.slug, i.type, i.name, i.description, i.asset, i.category,
                 i.season, i.rarity, inv.granted_at, inv.equipped
          FROM cosmetic_inventory inv JOIN cosmetic_items i ON i.id = inv.item_id
          WHERE inv.player_name = ?
          ORDER BY i.type, inv.granted_at DESC`,
    args: [playerName],
  });
  return (rs.rows as unknown as Record<string, unknown>[]).map(rowToItem);
}

/**
 * Equip or unequip an owned item. Card/title are single-equip (equipping one
 * unequips the others of that type); the equipped title mirrors into
 * players.title. Badges are capped at MAX_EQUIPPED_BADGES.
 */
export async function setEquipped(
  playerName: string,
  itemId: number,
  equip: boolean
): Promise<"ok" | "not_owned" | "badge_limit"> {
  await ensureCosmeticsSchema();
  const rs = await client.execute({
    sql: `SELECT i.type, i.name FROM cosmetic_inventory inv
          JOIN cosmetic_items i ON i.id = inv.item_id
          WHERE inv.player_name = ? AND inv.item_id = ?`,
    args: [playerName, itemId],
  });
  if (rs.rows.length === 0) return "not_owned";
  const type = rs.rows[0].type as CosmeticType;
  const name = rs.rows[0].name as string;
  const now = Date.now();

  if (!equip) {
    const stmts = [
      {
        sql: "UPDATE cosmetic_inventory SET equipped = 0, equipped_at = NULL WHERE player_name = ? AND item_id = ?",
        args: [playerName, itemId] as (string | number)[],
      },
    ];
    if (type === "title") {
      stmts.push({ sql: "UPDATE players SET title = '' WHERE name = ?", args: [playerName] });
    }
    await client.batch(stmts);
    return "ok";
  }

  if (type === "badge") {
    const countRs = await client.execute({
      sql: `SELECT COUNT(*) AS c FROM cosmetic_inventory inv
            JOIN cosmetic_items i ON i.id = inv.item_id
            WHERE inv.player_name = ? AND i.type = 'badge' AND inv.equipped = 1
              AND inv.item_id != ?`,
      args: [playerName, itemId],
    });
    if (Number(countRs.rows[0]?.c ?? 0) >= MAX_EQUIPPED_BADGES) return "badge_limit";
    await client.execute({
      sql: "UPDATE cosmetic_inventory SET equipped = 1, equipped_at = ? WHERE player_name = ? AND item_id = ?",
      args: [now, playerName, itemId],
    });
    return "ok";
  }

  // card / title: unequip every other item of the type, then equip the target.
  const stmts = [
    {
      sql: `UPDATE cosmetic_inventory SET equipped = 0, equipped_at = NULL
            WHERE player_name = ? AND item_id IN
              (SELECT id FROM cosmetic_items WHERE type = ?)`,
      args: [playerName, type] as (string | number)[],
    },
    {
      sql: "UPDATE cosmetic_inventory SET equipped = 1, equipped_at = ? WHERE player_name = ? AND item_id = ?",
      args: [now, playerName, itemId],
    },
  ];
  if (type === "title") {
    // Mirror into players.title so the bot's /checkplayer shows it.
    stmts.push({ sql: "UPDATE players SET title = ? WHERE name = ?", args: [name, playerName] });
  }
  await client.batch(stmts);
  return "ok";
}

/** The equipped cosmetics for a public profile (card, title text, ≤5 badges). */
export async function getEquippedCosmetics(playerName: string): Promise<ProfileCosmetics> {
  await ensureCosmeticsSchema();
  const rs = await client.execute({
    sql: `SELECT i.slug, i.type, i.name, i.description, i.asset
          FROM cosmetic_inventory inv JOIN cosmetic_items i ON i.id = inv.item_id
          WHERE inv.player_name = ? AND inv.equipped = 1
          ORDER BY inv.equipped_at ASC`,
    args: [playerName],
  });
  const out: ProfileCosmetics = { card: null, title: null, badges: [] };
  for (const r of rs.rows as unknown as Record<string, unknown>[]) {
    const type = r.type as CosmeticType;
    if (type === "card" && !out.card) {
      out.card = {
        slug: r.slug as string,
        name: r.name as string,
        asset: (r.asset as string) ?? null,
      };
    } else if (type === "title" && !out.title) {
      out.title = r.name as string;
    } else if (type === "badge" && out.badges.length < MAX_EQUIPPED_BADGES) {
      out.badges.push({
        slug: r.slug as string,
        name: r.name as string,
        description: (r.description as string) ?? "",
        asset: (r.asset as string) ?? null,
      });
    }
  }
  return out;
}
