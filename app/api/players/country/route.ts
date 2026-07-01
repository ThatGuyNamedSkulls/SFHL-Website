import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPlayerCountry, setPlayerCountry } from "@/lib/db";
import { isValidCountry } from "@/lib/countries";

/** GET — the logged-in user's linked player's country code (or null). */
export async function GET() {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ country: null, linked: false });
  }
  return NextResponse.json({
    country: await getPlayerCountry(session.playerName),
    linked: true,
  });
}

/** POST { code } — set the logged-in user's linked player's country. */
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
    const code = typeof body.code === "string" ? body.code.toLowerCase() : "";
    if (!isValidCountry(code)) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const ok = setPlayerCountry(session.playerName, code);
    if (!ok) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    return NextResponse.json({ country: code });
  } catch (error) {
    console.error("Error setting country:", error);
    return NextResponse.json({ error: "Failed to set country" }, { status: 500 });
  }
}
