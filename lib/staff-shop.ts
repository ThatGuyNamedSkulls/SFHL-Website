/**
 * The staff panel's Shop tab (CBL bot docs/STAFF_PANEL_PLAN.md step 5): the
 * whole cosmetic catalog with prices and how many players own each item.
 * Changes go through the bot's /item commands (lib/staff-jobs.ts).
 */
import { client } from "@/lib/db";

export interface ShopCatalogItem {
  slug: string;
  type: string;
  name: string;
  description: string;
  asset: string | null;
  category: string | null;
  rarity: string;
  /** HL Coins; 0 = not in the shop (grant-only). */
  price: number;
  owners: number;
}

type Row = Record<string, unknown>;

async function rows(sql: string): Promise<Row[]> {
  try {
    return (await client.execute(sql)).rows as unknown as Row[];
  } catch {
    return []; // no cosmetics tables yet
  }
}

export async function staffShopView(): Promise<{ items: ShopCatalogItem[] }> {
  const [items, owners] = await Promise.all([
    rows(
      `SELECT id, slug, type, name, COALESCE(description, '') AS description, asset, category,
              COALESCE(rarity, 'common') AS rarity, COALESCE(price, 0) AS price
         FROM cosmetic_items ORDER BY type, name`
    ),
    // One pass over the inventory instead of a count per item.
    rows("SELECT item_id, COUNT(*) AS n FROM cosmetic_inventory GROUP BY item_id"),
  ]);
  const ownersOf = new Map(owners.map((o) => [Number(o.item_id), Number(o.n) || 0]));
  return {
    items: items.map((i) => ({
      slug: String(i.slug),
      type: String(i.type),
      name: String(i.name),
      description: String(i.description ?? ""),
      asset: i.asset == null || i.asset === "" ? null : String(i.asset),
      category: i.category == null || i.category === "" ? null : String(i.category),
      rarity: String(i.rarity),
      price: Number(i.price) || 0,
      owners: ownersOf.get(Number(i.id)) ?? 0,
    })),
  };
}
