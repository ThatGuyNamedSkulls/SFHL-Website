import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getShop } from "@/lib/cosmetics";

/** GET — the logged-in user's HL Coin balance + the purchasable catalog. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  if (!session.playerName) {
    return NextResponse.json({ linked: false, coins: 0, items: [] });
  }
  try {
    const { coins, items } = await getShop(session.playerName);
    return NextResponse.json({ linked: true, coins, items });
  } catch (error) {
    console.error("Error fetching shop:", error);
    return NextResponse.json({ error: "Failed to fetch shop" }, { status: 500 });
  }
}
