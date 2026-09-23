import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import {
  PartyChatError,
  assertPartyMember,
  deletePartyChat,
  listPartyChat,
  postPartyChat,
} from "@/lib/party-chat";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fail(error: unknown, fallback: string) {
  if (error instanceof PartyChatError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** GET ?after=<id> — party chat for members (only newer messages with `after`). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to view party chat." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const after = Number(new URL(request.url).searchParams.get("after") || 0);
  try {
    await assertPartyMember(id, session.discordId);
    const messages = await listPartyChat(id, Number.isFinite(after) && after > 0 ? after : 0);
    return NextResponse.json({ messages });
  } catch (error) {
    return fail(error, "Failed to load party chat.");
  }
}

/** POST { message } — send to your party. */
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
    const entry = await postPartyChat(
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
    return fail(error, "Failed to send.");
  }
}

/** DELETE ?id=<messageId> — delete your own message (the leader can delete any). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const messageId = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "Missing message." }, { status: 400 });
  }
  try {
    await deletePartyChat(id, session.discordId, messageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, "Failed to delete.");
  }
}
