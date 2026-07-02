import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  sendFriendRequest,
  removeFriend,
} from "@/lib/social";

/** 403 unless the session is linked to an SFHL player (friends key on name). */
function requireLinked(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return { error: "You must be logged in", status: 401 as const };
  if (!session.playerName)
    return {
      error: "Your Discord account isn't linked to an SFHL player yet.",
      status: 403 as const,
    };
  return null;
}

/** GET — the current user's friends + incoming/outgoing requests. */
export async function GET() {
  const session = await getSession();
  const gate = requireLinked(session);
  if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const me = session!.playerName!;
  const [friends, incoming, outgoing] = await Promise.all([
    getFriends(me),
    getIncomingRequests(me),
    getOutgoingRequests(me),
  ]);
  return NextResponse.json({ friends, incoming, outgoing });
}

/** POST { toName } — send a friend request. */
export async function POST(request: Request) {
  const session = await getSession();
  const gate = requireLinked(session);
  if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { toName } = await request.json().catch(() => ({}));
  if (!toName || typeof toName !== "string") {
    return NextResponse.json({ error: "Missing target player" }, { status: 400 });
  }
  const result = await sendFriendRequest(session!.playerName!, toName);
  if (result === "self") return NextResponse.json({ error: "You can't add yourself" }, { status: 400 });
  if (result === "no_such_player")
    return NextResponse.json({ error: "No such player" }, { status: 404 });
  return NextResponse.json({ status: result });
}

/** DELETE { name } — remove a friend. */
export async function DELETE(request: Request) {
  const session = await getSession();
  const gate = requireLinked(session);
  if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { name } = await request.json().catch(() => ({}));
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing friend name" }, { status: 400 });
  }
  await removeFriend(session!.playerName!, name);
  return NextResponse.json({ ok: true });
}
