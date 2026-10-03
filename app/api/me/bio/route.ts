import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPlayer } from "@/lib/db";
import { LIMITS, limited } from "@/lib/rate-limit";
import { BIO_MAX_LENGTH, bioError, getBio, normalizeBio, setBio } from "@/lib/player-bios";
import type { UserSession } from "@/types";

export const dynamic = "force-dynamic";

/** The signed-in player's row id, or the reason there isn't one. */
async function myPlayerId(session: UserSession | null): Promise<number | NextResponse> {
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const player = session.playerName ? await getPlayer(session.playerName) : undefined;
  if (!player) {
    return NextResponse.json({ error: "Link a HyperLeague player to write a bio." }, { status: 400 });
  }
  return Number(player.id);
}

/** GET — your own bio, for the Settings editor. */
export async function GET() {
  const id = await myPlayerId(await getSession());
  if (id instanceof NextResponse) return id;
  return NextResponse.json({ bio: (await getBio(id)) ?? "", max: BIO_MAX_LENGTH });
}

/** POST { bio } — save your bio (an empty one removes it). */
export async function POST(request: Request) {
  const session = await getSession();
  if (session) {
    const limitHit = await limited(`profileEdit:${session.discordId}`, LIMITS.profileEdit);
    if (limitHit) return limitHit;
  }
  const id = await myPlayerId(session);
  if (id instanceof NextResponse) return id;

  const body = await request.json().catch(() => ({} as { bio?: unknown }));
  if (typeof body.bio !== "string") {
    return NextResponse.json({ error: "Missing bio." }, { status: 400 });
  }
  const bio = normalizeBio(body.bio);
  const problem = bioError(bio);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  try {
    await setBio(id, bio);
    return NextResponse.json({ bio });
  } catch (error) {
    console.error("bio POST", error);
    return NextResponse.json({ error: "Could not save your bio." }, { status: 500 });
  }
}
