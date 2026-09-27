import { NextResponse } from "next/server";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { getPlayerByDiscordId, getPlayerCountry, setPlayerCountry } from "@/lib/db";
import { isValidCountry } from "@/lib/countries";

// The linked player is found by Discord id ONLY. An earlier name / display-name
// fallback let an unlinked login claim a player row (docs/WEBSITE_SECURITY_REPORT.md H1).

/** GET — the logged-in user's linked player's country code (or null). */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ country: null, linked: false });
    }
    const player = await getPlayerByDiscordId(session.discordId);
    if (!player) {
      return NextResponse.json({ country: null, linked: false });
    }
    const raw = await getPlayerCountry(session.discordId);
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
  const limitHit = await limited(`general:${session.discordId}`, LIMITS.general);
  if (limitHit) return limitHit;

  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.toLowerCase() : "";
    if (!isValidCountry(code)) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const ok = await setPlayerCountry(session.discordId, code);
    if (!ok) {
      return NextResponse.json(
        { error: "Your Discord account is not linked to a HyperLeague player." },
        { status: 403 }
      );
    }
    return NextResponse.json({ country: code });
  } catch (error) {
    console.error("Error setting country:", error);
    return NextResponse.json({ error: "Failed to set country" }, { status: 500 });
  }
}
