import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  sendFriendRequest,
  removeFriend,
  getUser,
} from "@/lib/social";

/** GET — the current user's friends + incoming/outgoing requests. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const [friends, incoming, outgoing] = await Promise.all([
    getFriends(session.discordId),
    getIncomingRequests(session.discordId),
    getOutgoingRequests(session.discordId),
  ]);
  return NextResponse.json({ friends, incoming, outgoing });
}

/** POST { toId } — send a friend request. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const { toId } = await request.json().catch(() => ({}));
  if (!toId || typeof toId !== "string") {
    return NextResponse.json({ error: "Missing target user" }, { status: 400 });
  }

  const me = (await getUser(session.discordId)) ?? {
    discord_id: session.discordId,
    username: session.username,
    avatar: session.avatar,
    player_name: session.playerName,
  };
  const result = await sendFriendRequest(me, toId);
  if (result === "self") {
    return NextResponse.json({ error: "You can't add yourself" }, { status: 400 });
  }
  return NextResponse.json({ status: result });
}

/** DELETE { id } — remove a friend. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const { id } = await request.json().catch(() => ({}));
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing friend id" }, { status: 400 });
  }
  await removeFriend(session.discordId, id);
  return NextResponse.json({ ok: true });
}
