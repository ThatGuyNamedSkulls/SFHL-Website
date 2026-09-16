import { NextResponse } from "next/server";
import { getSession, isUserInGuildCached } from "@/lib/auth";
import { claimSubRequest } from "@/lib/subs";
import { upsertWebUser } from "@/lib/social";

export const dynamic = "force-dynamic";

/**
 * POST — claim an open substitute slot.
 *
 * All the eligibility rules live in `claimSubRequest` so this route and the
 * Discord button can't drift apart. The claim itself is a conditional UPDATE,
 * so a simultaneous click elsewhere loses cleanly with a 409 instead of
 * overwriting the winner.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to join a match as a substitute" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({} as { requestId?: unknown }));
  const requestId = Number(body.requestId);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "Which slot?" }, { status: 400 });
  }

  const liveInGuild = await isUserInGuildCached(session.discordId);
  const result = await claimSubRequest(
    {
      discordId: session.discordId,
      playerName: session.playerName ?? null,
      inGuild: liveInGuild === null ? !!session.inGuild : liveInGuild,
    },
    requestId
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Remember the Discord id so the bot can DM this player the match details.
  if (session.playerName) {
    upsertWebUser(session.discordId, session.playerName, session.username).catch(
      () => {}
    );
  }

  return NextResponse.json({
    message: "You're in",
    request: result.request,
  });
}
