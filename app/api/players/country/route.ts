import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPlayerCountry, resolveLinkedPlayer, setPlayerCountry } from "@/lib/db";
import { isValidCountry } from "@/lib/countries";
import { UserSession } from "@/types";

async function linkedPlayer(session: UserSession) {
  const byDiscord = await resolveLinkedPlayer(session.playerName, session.discordId);
  if (byDiscord) return byDiscord;
  for (const alias of [session.username, session.discordUsername]) {
    if (!alias || alias === session.playerName) continue;
    const row = await resolveLinkedPlayer(alias, null);
    if (row) return row;
  }
  return undefined;
}

/** GET — the logged-in user's linked player's country code (or null). */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ country: null, linked: false });
    }
    const player = await linkedPlayer(session);
    if (!player) {
      return NextResponse.json({ country: null, linked: false });
    }
    const raw = await getPlayerCountry(player.name, session.discordId);
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
    const player = await linkedPlayer(session);
    if (!player) {
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
    const ok = await setPlayerCountry(player.name, code, session.discordId);
    const saved = ok
      ? await getPlayerCountry(player.name, session.discordId)
      : null;
    if (!isValidCountry(saved) || saved !== code) {
      return NextResponse.json({ error: "Could not save country" }, { status: 500 });
    }
    return NextResponse.json({ country: saved });
  } catch (error) {
    console.error("Error setting country:", error);
    return NextResponse.json({ error: "Failed to set country" }, { status: 500 });
  }
}
