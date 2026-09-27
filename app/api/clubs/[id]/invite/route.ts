import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { clubForClient, clubLeaderboard, createInvite } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  try {
    const club = await createInvite(id, session.discordId);
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club: clubForClient(club, session.discordId), leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to create invite.") },
      { status: 400 }
    );
  }
}
