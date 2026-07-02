import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParties, createParty } from "@/lib/parties";
import { memberFromSession } from "@/lib/party-member";
import { getPartyInvitesFor } from "@/lib/social";

/** GET — list live parties. Private parties are hidden unless you're a member
 *  or have a pending invite to them. */
export async function GET() {
  try {
    const session = await getSession();
    const parties = await getParties();
    const invitedIds = session
      ? new Set((await getPartyInvitesFor(session.discordId)).map((i) => i.partyId))
      : new Set<string>();

    const visible = parties.filter((p) => {
      if (!p.isPrivate) return true;
      if (!session) return false;
      const isMember = p.members.some((m) => m.discordId === session.discordId);
      return isMember || invitedIds.has(p.id);
    });
    return NextResponse.json({ parties: visible, count: visible.length });
  } catch (error) {
    console.error("Error listing parties:", error);
    return NextResponse.json({ parties: [], count: 0 });
  }
}

/** POST — create a new party (requires auth). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in to create a party" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const party = await createParty({
      name: body.name,
      game: body.game,
      gameMode: body.gameMode,
      matchType: body.matchType,
      region: body.region,
      minSkill: body.minSkill,
      maxSkill: body.maxSkill,
      language: body.language,
      countries: body.countries,
      verifiedOnly: body.verifiedOnly,
      voiceRequired: body.voiceRequired,
      isPrivate: body.isPrivate,
      leader: await memberFromSession(session),
    });
    return NextResponse.json({ party });
  } catch (error) {
    console.error("Error creating party:", error);
    return NextResponse.json({ error: "Failed to create party" }, { status: 500 });
  }
}
