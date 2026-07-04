import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParty, joinParty } from "@/lib/parties";
import { memberFromSession, withFreshCosmetics } from "@/lib/party-member";
import { clearPartyInvite, hasPartyInvite } from "@/lib/social";

/** POST — join a party (requires auth). Private parties require an invite. */
export async function POST(_request: Request, ctx: RouteContext<"/api/parties/[id]/join">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in to join a party" }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;

    // Private parties are invite-only (invites are keyed on player name).
    const party = await getParty(id);
    const myName = session.playerName;
    if (party?.isPrivate && !party.members.some((m) => m.discordId === session.discordId)) {
      const invited = myName ? await hasPartyInvite(id, myName) : false;
      if (!invited) {
        return NextResponse.json(
          { error: "This party is private — you need an invite to join." },
          { status: 403 }
        );
      }
    }

    const result = await joinParty(id, await memberFromSession(session));
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // Consume the invite once used.
    if (myName) await clearPartyInvite(id, myName);
    const [freshParty] = await withFreshCosmetics([result]);
    return NextResponse.json({ party: freshParty });
  } catch (error) {
    console.error("Error joining party:", error);
    return NextResponse.json({ error: "Failed to join party" }, { status: 500 });
  }
}
