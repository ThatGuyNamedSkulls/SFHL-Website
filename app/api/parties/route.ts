import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getParties, createParty } from "@/lib/parties";
import { memberFromSession } from "@/lib/party-member";

/** GET — list all live parties. */
export async function GET() {
  try {
    const parties = getParties();
    return NextResponse.json({ parties, count: parties.length });
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
    const party = createParty({
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
      leader: await memberFromSession(session),
    });
    return NextResponse.json({ party });
  } catch (error) {
    console.error("Error creating party:", error);
    return NextResponse.json({ error: "Failed to create party" }, { status: 500 });
  }
}
