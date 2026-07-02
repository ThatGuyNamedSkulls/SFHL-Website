import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rejectFriendRequest } from "@/lib/social";

/** POST { fromName } — decline the incoming friend request from `fromName`. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const { fromName } = await request.json().catch(() => ({}));
  if (!fromName || typeof fromName !== "string") {
    return NextResponse.json({ error: "Missing requester" }, { status: 400 });
  }
  await rejectFriendRequest(session.playerName, fromName);
  return NextResponse.json({ ok: true });
}
