import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParty } from "@/lib/parties";
import { areFriends, createPartyInvite } from "@/lib/social";

/** POST { toName } — invite a friend (by player name) to the party. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ error: "You must be logged in and linked to a player" }, { status: 401 });
  }
  const me = session.playerName;

  try {
    const { id } = await ctx.params;
    const { toName } = await request.json().catch(() => ({}));
    if (!toName || typeof toName !== "string") {
      return NextResponse.json({ error: "Missing target player" }, { status: 400 });
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
    if (!(await areFriends(me, toName))) {
      return NextResponse.json({ error: "You can only invite friends" }, { status: 403 });
    }
    if (party.members.some((m) => m.playerName === toName)) {
      return NextResponse.json({ error: "They are already in the party" }, { status: 409 });
    }
    if (party.members.length >= party.maxSize) {
      return NextResponse.json({ error: "Party is full" }, { status: 409 });
    }

    await createPartyInvite(party.id, me, toName, party.name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error inviting to party:", error);
    return NextResponse.json({ error: "Failed to invite" }, { status: 500 });
  }
}
