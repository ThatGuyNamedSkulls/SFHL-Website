import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getInventory, setEquipped, MAX_EQUIPPED_BADGES } from "@/lib/cosmetics";

/**
 * POST { itemId, equip } — equip/unequip an owned cosmetic item.
 * The item's type (and any type rules) come from the catalog server-side.
 */
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
    const equip = Boolean(body.equip);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "Invalid item" }, { status: 400 });
    }

    const result = await setEquipped(session.playerName, itemId, equip);
    if (result === "not_owned") {
      return NextResponse.json({ error: "You don't own this item." }, { status: 404 });
    }
    if (result === "badge_limit") {
      return NextResponse.json(
        { error: `You can only equip ${MAX_EQUIPPED_BADGES} badges. Unequip one first.` },
        { status: 409 }
      );
    }
    // Return the refreshed inventory so the client updates in one round trip.
    const items = await getInventory(session.playerName);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("Error equipping item:", error);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}
