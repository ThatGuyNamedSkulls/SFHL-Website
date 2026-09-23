import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getShop, listShopCatalog } from "@/lib/cosmetics";

/** GET — purchasable catalog. Balance only when linked. */
export async function GET() {
  const session = await getSession();
  try {
    if (session?.playerName) {
      const { coins, items } = await getShop(session.playerName);
      return NextResponse.json({ linked: true, coins, items });
    }
    const items = await listShopCatalog();
    return NextResponse.json({
      linked: !!session,
      coins: 0,
      items: items.map((item) => ({ ...item, owned: false })),
    });
  } catch (error) {
    console.error("Error fetching shop:", error);
    return NextResponse.json({ error: "Failed to fetch shop" }, { status: 500 });
  }
}
