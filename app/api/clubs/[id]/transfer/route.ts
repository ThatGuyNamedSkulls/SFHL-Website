import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { clubForClient, clubLeaderboard, transferOwnership } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as { discordId?: string }));
  const targetId = String(body.discordId ?? "");
  if (!targetId) {
    return NextResponse.json({ error: "Pick a member to transfer to." }, { status: 400 });
  }
  try {
    const club = await transferOwnership(id, session.discordId, targetId);
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club: clubForClient(club, session.discordId), leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to transfer ownership.") },
      { status: 400 }
    );
  }
}
