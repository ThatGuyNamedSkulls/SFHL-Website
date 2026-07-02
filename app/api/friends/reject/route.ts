import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rejectFriendRequest } from "@/lib/social";

/** POST { fromId } — decline the incoming friend request from `fromId`. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const { fromId } = await request.json().catch(() => ({}));
  if (!fromId || typeof fromId !== "string") {
    return NextResponse.json({ error: "Missing requester id" }, { status: 400 });
  }
  await rejectFriendRequest(session.discordId, fromId);
  return NextResponse.json({ ok: true });
}
