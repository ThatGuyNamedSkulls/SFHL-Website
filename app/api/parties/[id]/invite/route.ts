import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParty } from "@/lib/parties";
import { areFriends, createPartyInvite, getUser } from "@/lib/social";

/** POST { toId } — invite a friend to the party (members only). */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;
    const { toId } = await request.json().catch(() => ({}));
    if (!toId || typeof toId !== "string") {
      return NextResponse.json({ error: "Missing target user" }, { status: 400 });
    }

    const party = await getParty(id);
    if (!party) {
      return NextResponse.json({ error: "Party not found or expired" }, { status: 404 });
    }
    // Only members can invite.
    if (!party.members.some((m) => m.discordId === session.discordId)) {
      return NextResponse.json({ error: "You are not in this party" }, { status: 403 });
    }
    // You can only invite people you're friends with.
    if (!(await areFriends(session.discordId, toId))) {
      return NextResponse.json({ error: "You can only invite friends" }, { status: 403 });
    }
    if (party.members.some((m) => m.discordId === toId)) {
      return NextResponse.json({ error: "They are already in the party" }, { status: 409 });
    }
    if (party.members.length >= party.maxSize) {
      return NextResponse.json({ error: "Party is full" }, { status: 409 });
    }

    const me = (await getUser(session.discordId)) ?? {
      discord_id: session.discordId,
      username: session.username,
      avatar: session.avatar,
      player_name: session.playerName,
    };
    await createPartyInvite(party.id, me, toId, party.name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error inviting to party:", error);
    return NextResponse.json({ error: "Failed to invite" }, { status: 500 });
  }
}
