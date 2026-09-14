import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addGuestbookEntry, listGuestbook } from "@/lib/guestbook";

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
  const body = await request.json().catch(() => ({} as { toName?: string; message?: string }));
  const toName = typeof body.toName === "string" ? body.toName.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!toName) {
    return NextResponse.json({ error: "Missing profile" }, { status: 400 });
  }
  if (message.length < 1 || message.length > 280) {
    return NextResponse.json({ error: "Message must be 1–280 characters." }, { status: 400 });
  }
  try {
    const entry = await addGuestbookEntry(toName, session.playerName, message);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error("guestbook POST", error);
    return NextResponse.json({ error: "Failed to post" }, { status: 500 });
  }
}
