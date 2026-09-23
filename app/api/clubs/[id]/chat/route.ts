import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import { getClub, memberOf } from "@/lib/clubs";
import { deleteClubChat, listClubChat, postClubChat } from "@/lib/club-chat";
import { MAX_CHAT_FETCH, parseChatLimit } from "@/lib/chat-limits";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET ?limit=<n> — club chat (the right-bar chat asks for the last 10). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to view club chat." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const club = await getClub(id);
  if (!club) return NextResponse.json({ error: "Club not found." }, { status: 404 });
  if (!memberOf(club, session.discordId)) {
    return NextResponse.json({ error: "Join the club to view chat." }, { status: 403 });
  }
  try {
    const limit = parseChatLimit(new URL(request.url).searchParams.get("limit"), MAX_CHAT_FETCH);
    const messages = await listClubChat(id, limit);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("club chat GET", error);
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to chat." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as { message?: string }));
  const message = typeof body.message === "string" ? body.message : "";
  if (containsProfanity(message)) {
    return NextResponse.json(
      { error: "Message contains language that is not allowed." },
      { status: 400 }
    );
  }
  try {
    const entry = await postClubChat(
      id,
      {
        discordId: session.discordId,
        username: session.username,
        playerName: session.playerName,
        avatar: session.avatar,
      },
      message
    );
    return NextResponse.json({ message: entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const messageId = Number(
    new URL(request.url).searchParams.get("id") ||
      (await request.json().catch(() => ({} as { id?: number }))).id
  );
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "Missing message." }, { status: 400 });
  }
  try {
    await deleteClubChat(id, session.discordId, messageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete." },
      { status: 400 }
    );
  }
}
