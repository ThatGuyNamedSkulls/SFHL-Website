import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getNotifications, getUnreadCount, markNotificationsRead } from "@/lib/social";

/** GET — the current user's notifications + unread count. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ notifications: [], unread: 0 });
  }
  const [notifications, unread] = await Promise.all([
    getNotifications(session.discordId),
    getUnreadCount(session.discordId),
  ]);
  return NextResponse.json({ notifications, unread });
}

/** POST — mark all of the current user's notifications as read. */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  await markNotificationsRead(session.discordId);
  return NextResponse.json({ ok: true });
}
