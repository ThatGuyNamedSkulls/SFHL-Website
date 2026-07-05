import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getShop, purchaseItem } from "@/lib/cosmetics";

const MESSAGES: Record<string, string> = {
  not_for_sale: "This item isn't for sale.",
  already_owned: "You already own this item.",
  insufficient: "You don't have enough HL Coins.",
  no_such_item: "That item doesn't exist.",
  no_such_player: "Your account isn't linked to a player.",
};

/** POST { itemId } — buy a catalog item with HL Coins. Atomic in lib/cosmetics. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  if (!session.playerName) {
    return NextResponse.json(
      { error: "Your Discord account is not linked to a HyperLeague player." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const itemId = Number(body.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "Invalid item" }, { status: 400 });
    }

    const result = await purchaseItem(session.playerName, itemId);
    if (result.status !== "ok") {
      const status = result.status === "insufficient" ? 402 : 409;
      // Return the fresh shop so the client can reconcile balance/ownership.
      const shop = await getShop(session.playerName);
      return NextResponse.json(
        { error: MESSAGES[result.status] ?? "Purchase failed.", coins: shop.coins, items: shop.items },
        { status }
      );
    }

    const shop = await getShop(session.playerName);
    return NextResponse.json({ ok: true, coins: shop.coins, items: shop.items });
  } catch (error) {
    console.error("Error buying item:", error);
    return NextResponse.json({ error: "Failed to buy item" }, { status: 500 });
  }
}
