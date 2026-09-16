import { NextResponse } from "next/server";
import { getSession, isUserInGuildCached } from "@/lib/auth";
import { listSubRequests, withdrawSubClaim, Claimer } from "@/lib/subs";

export const dynamic = "force-dynamic";

/** The signed-in viewer as a claimer, with guild membership re-checked live. */
async function currentClaimer(): Promise<Claimer | null> {
  const session = await getSession();
  if (!session) return null;
  // Someone who left the Discord server since logging in must not be able to
  // claim, so trust the live (cached) check over the login-time flag.
  const liveInGuild = await isUserInGuildCached(session.discordId);
  return {
    discordId: session.discordId,
    playerName: session.playerName ?? null,
    inGuild: liveInGuild === null ? !!session.inGuild : liveInGuild,
  };
}

/** GET — open substitute slots, annotated with this viewer's eligibility. */
export async function GET() {
  try {
    const claimer = await currentClaimer();
    const requests = await listSubRequests(claimer);
    return NextResponse.json({
      requests,
      count: requests.length,
      eligibleCount: requests.filter((r) => r.eligible).length,
    });
  } catch (error) {
    console.error("Error listing sub requests:", error);
    return NextResponse.json({ requests: [], count: 0, eligibleCount: 0 });
  }
}

/** DELETE — withdraw your own claim, while the bot hasn't applied it yet. */
export async function DELETE(request: Request) {
  const claimer = await currentClaimer();
  if (!claimer) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Which slot?" }, { status: 400 });
  }

  const result = await withdrawSubClaim(claimer, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 }
    );
  }
  return NextResponse.json({ message: "Claim withdrawn" });
}
