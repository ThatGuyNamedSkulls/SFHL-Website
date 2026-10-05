import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLobbyForUser } from "@/lib/lobby";
import { overtimeVoteFor } from "@/lib/overtime-votes";

/** GET — the active post-queue lobby (match) the logged-in user is in, or null.
 *  Written by the bot when a queue fills; read-only here. Carries the match's
 *  overtime tie vote while one is open (or just ended). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ lobby: null });
  try {
    const lobby = await getLobbyForUser(session.discordId);
    if (!lobby) return NextResponse.json({ lobby: null });
    const overtimeVote = await overtimeVoteFor(lobby.channelId, session.discordId).catch(() => null);
    return NextResponse.json({ lobby: { ...lobby, overtimeVote } });
  } catch (error) {
    console.error("Error fetching lobby:", error);
    return NextResponse.json({ lobby: null });
  }
}
