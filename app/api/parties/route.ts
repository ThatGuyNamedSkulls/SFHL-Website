import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParties, createParty } from "@/lib/parties";
import { memberFromSession, withFreshCosmetics } from "@/lib/party-member";
import { getPartyInvitePartyIds, getInvitesForParties } from "@/lib/social";

/** GET — list live parties. Private parties are hidden unless you're a member
 *  or have a pending invite to them. Each party carries the names it has pending
 *  invites out to, so members' invite menus can show "Invited". */
export async function GET() {
  try {
    const session = await getSession();
    const parties = await getParties();
    const invitedIds =
      session?.playerName
        ? new Set(await getPartyInvitePartyIds(session.playerName))
        : new Set<string>();

    const visible = parties.filter((p) => {
      if (!p.isPrivate) return true;
      if (!session) return false;
      const isMember = p.members.some((m) => m.discordId === session.discordId);
      return isMember || invitedIds.has(p.id);
    });

    // Attach pending-invite names to parties the viewer is a member of.
    const myPartyIds = session
      ? visible.filter((p) => p.members.some((m) => m.discordId === session.discordId)).map((p) => p.id)
      : [];
    const invitesByParty = await getInvitesForParties(myPartyIds);
    // Re-resolve each member's equipped card/frame so cosmetic changes made
    // after joining show up without re-joining the party.
    const fresh = await withFreshCosmetics(visible);
    const withInvites = fresh.map((p) => ({
      ...p,
      invitedNames: invitesByParty.get(p.id) ?? [],
    }));

    return NextResponse.json({ parties: withInvites, count: withInvites.length });
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
      vibe: body.vibe,
      // Party size follows the match type (Super caps at 3, Premium at 2).
      maxSize: [2, 3, 5].includes(body.maxSize) ? body.maxSize : 5,
      leader: await memberFromSession(session),
    });
    return NextResponse.json({ party });
  } catch (error) {
    console.error("Error creating party:", error);
    return NextResponse.json({ error: "Failed to create party" }, { status: 500 });
  }
}
