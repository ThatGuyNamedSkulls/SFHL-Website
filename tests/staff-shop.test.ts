/**
 * The staff panel's Shop tab catalog (CBL bot docs/STAFF_PANEL_PLAN.md step 5):
 * every item with its price and how many players own it, and an empty list
 * before the cosmetics tables exist.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-shop");
let shop: typeof import("@/lib/staff-shop");
let client: typeof import("@/lib/db").client;
let emptyBefore: Awaited<ReturnType<typeof import("@/lib/staff-shop")["staffShopView"]>>;

before(async () => {
  shop = await import("@/lib/staff-shop");
  client = (await import("@/lib/db")).client;
  emptyBefore = await shop.staffShopView();
  await client.batch(
    [
      `CREATE TABLE cosmetic_items (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, type TEXT, name TEXT,
         description TEXT, asset TEXT, category TEXT, season TEXT, rarity TEXT, created_at INTEGER, price INTEGER)`,
      "CREATE TABLE cosmetic_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT, item_id INTEGER)",
      `INSERT INTO cosmetic_items (slug, type, name, description, asset, category, rarity, price) VALUES
         ('gold-card', 'card', 'Gold Card', 'Shiny', '/profilecards/gold.png', NULL, 'epic', 500),
         ('top10-current', 'badge', 'Top 10', NULL, '/badgeicons/top10.png', 'seasonal', NULL, NULL),
         ('navy', 'background', 'Navy', '', '#1e3a8a', '', 'common', 0)`,
      "INSERT INTO cosmetic_inventory (player_name, item_id) VALUES ('a', 1), ('b', 1), ('a', 2)",
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["cosmetic_items", "cosmetic_inventory"]);
});

describe("staff shop catalog", () => {
  it("is empty before the cosmetics tables exist", () => {
    assert.deepEqual(emptyBefore.items, []);
  });

  it("lists every item with its price and owners", async () => {
    const { items } = await shop.staffShopView();
    assert.deepEqual(items.map((i) => i.slug), ["navy", "top10-current", "gold-card"], "by type, then name");
    const bySlug = Object.fromEntries(items.map((i) => [i.slug, i]));
    assert.equal(bySlug["gold-card"].owners, 2);
    assert.equal(bySlug["gold-card"].price, 500);
    assert.equal(bySlug["top10-current"].price, 0, "no price = grant-only");
    assert.equal(bySlug["top10-current"].rarity, "common");
    assert.equal(bySlug.navy.owners, 0);
    assert.equal(bySlug.navy.category, null, "empty text reads as none");
    assert.equal(bySlug.navy.asset, "#1e3a8a");
  });
});
