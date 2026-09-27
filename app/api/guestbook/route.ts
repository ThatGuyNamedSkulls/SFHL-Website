import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { addGuestbookEntry, canonicalPlayerName, deleteGuestbookEntry, listGuestbook } from "@/lib/guestbook";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { GUESTBOOK_MAX_LENGTH, containsProfanity } from "@/lib/content-moderation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const player = url.searchParams.get("player")?.trim();
  if (!player) {
    return NextResponse.json({ error: "Missing player" }, { status: 400 });
  }
  try {
    const entries = await listGuestbook(player);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("guestbook GET", error);
    return NextResponse.json({ entries: [] });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json(
      { error: "Log in with a linked HyperLeague player to write in a guestbook." },
      { status: 401 }
    );
  }
  const limitHit = await limited(`guestbook:${session.discordId}`, LIMITS.guestbook);
  if (limitHit) return limitHit;
  const body = await request.json().catch(() => ({} as { toName?: string; message?: string }));
  const toName = typeof body.toName === "string" ? body.toName.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!toName) {
    return NextResponse.json({ error: "Missing profile" }, { status: 400 });
  }
  if (message.length < 1 || message.length > GUESTBOOK_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Message must be 1–${GUESTBOOK_MAX_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (containsProfanity(message)) {
    return NextResponse.json(
      { error: "Message contains language that is not allowed." },
      { status: 400 }
    );
  }
  // Only real players have a guestbook (no posting to made-up names).
  const profileName = await canonicalPlayerName(toName);
  if (!profileName) {
    return NextResponse.json({ error: "No such player." }, { status: 404 });
  }
  try {
    const entry = await addGuestbookEntry(profileName, session.playerName, message);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error("guestbook POST", error);
    return NextResponse.json({ error: "Failed to post" }, { status: 500 });
  }
}

/** DELETE ?id= — the profile owner, the author, or Match Staff removes an entry. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const limitHit = await limited(`general:${session.discordId}`, LIMITS.general);
  if (limitHit) return limitHit;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Missing message." }, { status: 400 });
  }
  try {
    const staff = await isMatchStaff(session.discordId).catch(() => false);
    const found = await deleteGuestbookEntry(id, { playerName: session.playerName, staff });
    if (!found) return NextResponse.json({ error: "Message not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Failed to delete.") }, { status: 403 });
  }
}
