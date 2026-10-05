import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLobbyForUser } from "@/lib/lobby";
import { OvertimeVoteError, voteTie } from "@/lib/overtime-votes";
import { LIMITS, limited } from "@/lib/rate-limit";
import { publicErrorMessage } from "@/lib/route-errors";

export const dynamic = "force-dynamic";

/** POST — vote "tie" in your match's overtime vote (the same vote as the Discord button). */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const limitHit = await limited(`general:${session.discordId}`, LIMITS.general);
  if (limitHit) return limitHit;
  try {
    const lobby = await getLobbyForUser(session.discordId);
    if (!lobby) return NextResponse.json({ error: "You're not in a live match." }, { status: 404 });
    const vote = await voteTie(lobby.channelId, session.discordId);
    return NextResponse.json({ vote });
  } catch (error) {
    if (error instanceof OvertimeVoteError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't count your vote.") }, { status: 500 });
  }
}
