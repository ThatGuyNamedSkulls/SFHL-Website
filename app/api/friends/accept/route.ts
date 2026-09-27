import { NextResponse } from "next/server";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { acceptFriendRequest } from "@/lib/social";

/** POST { fromName } — accept the incoming friend request from `fromName`. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const limitHit = await limited(`general:${session.discordId}`, LIMITS.general);
  if (limitHit) return limitHit;
  const { fromName } = await request.json().catch(() => ({}));
  if (!fromName || typeof fromName !== "string") {
    return NextResponse.json({ error: "Missing requester" }, { status: 400 });
  }
  await acceptFriendRequest(session.playerName, fromName);
  return NextResponse.json({ ok: true });
}
