import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import {
  answerJoinRequest,
  clubForClient,
  clubLeaderboard,
  notifyRequestAnswer,
} from "@/lib/clubs";

export const dynamic = "force-dynamic";

/** Accept or decline a join request. Body: { discordId, accept: boolean }. Needs the invite permission. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { discordId?: unknown; accept?: unknown };
  if (typeof body.discordId !== "string" || typeof body.accept !== "boolean") {
    return NextResponse.json({ error: "Missing discordId or accept." }, { status: 400 });
  }
  try {
    const { club, request: answered } = await answerJoinRequest(
      id,
      session.discordId,
      body.discordId,
      body.accept
    );
    try {
      await notifyRequestAnswer(club, answered, body.accept, session.playerName);
    } catch (error) {
      console.error("clan join request answer notify", error);
    }
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club: clubForClient(club, session.discordId), leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to answer the request.") },
      { status: 400 }
    );
  }
}
