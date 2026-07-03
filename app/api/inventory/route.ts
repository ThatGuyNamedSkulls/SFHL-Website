import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getInventory } from "@/lib/cosmetics";

/** GET — the logged-in user's cosmetic inventory (cards, titles, badges). */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  if (!session.playerName) {
    return NextResponse.json({ linked: false, items: [] });
  }
  try {
    const items = await getInventory(session.playerName);
    return NextResponse.json({ linked: true, items });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json({ error: "Failed to fetch inventory" }, { status: 500 });
  }
}
