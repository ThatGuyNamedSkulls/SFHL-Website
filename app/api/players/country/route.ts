import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPlayerByDiscordId, getPlayerCountry, setPlayerCountry } from "@/lib/db";
import { isValidCountry } from "@/lib/countries";

async function linkedPlayer(session: { playerName?: string | null; discordId: string }) {
  const byDiscord = await getPlayerByDiscordId(session.discordId);
  return byDiscord?.name || session.playerName || null;
}

/** GET — the logged-in user's linked player's country code (or null). */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ country: null, linked: false });
    }
    const playerName = await linkedPlayer(session);
    if (!playerName) {
      return NextResponse.json({ country: null, linked: false });
    }
    const raw = await getPlayerCountry(playerName, session.discordId);
    return NextResponse.json({
      country: isValidCountry(raw) ? raw : null,
      linked: true,
    });
  } catch (error) {
    console.error("Error reading country:", error);
    return NextResponse.json({ country: null, linked: false }, { status: 500 });
  }
}

/** POST { code } — set the logged-in user's linked player's country. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  try {
    const playerName = await linkedPlayer(session);
    if (!playerName) {
      return NextResponse.json(
        { error: "Your Discord account is not linked to a HyperLeague player." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.toLowerCase() : "";
    if (!isValidCountry(code)) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const ok = await setPlayerCountry(playerName, code, session.discordId);
    if (!ok) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    return NextResponse.json({ country: code });
  } catch (error) {
    console.error("Error setting country:", error);
    return NextResponse.json({ error: "Failed to set country" }, { status: 500 });
  }
}
