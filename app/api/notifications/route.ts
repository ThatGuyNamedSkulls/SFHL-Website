import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getNotifications, getUnreadCount, markNotificationsRead } from "@/lib/social";
import { getLobbyForUser } from "@/lib/lobby";

/** GET — the current user's notifications + unread count. */
export async function GET() {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ notifications: [], unread: 0 });
  }
  const [notifications, unread, lobby] = await Promise.all([
    getNotifications(session.playerName),
    getUnreadCount(session.playerName),
    getLobbyForUser(session.discordId),
  ]);
  const items = [...notifications];
  if (lobby) {
    items.unshift({
      id: -1,
      type: "match_found",
      message: `Match found — ${lobby.channelName}. Join voice and open the match room.`,
      actorId: null,
      refId: lobby.channelId,
      read: false,
      createdAt: lobby.createdAt,
    });
  }
  return NextResponse.json({
    notifications: items,
    unread: unread + (lobby ? 1 : 0),
  });
}

/** POST — mark all of the current user's notifications as read. */
export async function POST() {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  await markNotificationsRead(session.playerName);
  return NextResponse.json({ ok: true });
}
