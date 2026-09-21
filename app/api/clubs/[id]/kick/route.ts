import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clubForClient, clubLeaderboard, kickMember } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as { discordId?: string }));
  const targetId = String(body.discordId ?? "");
  if (!targetId) {
    return NextResponse.json({ error: "Missing member." }, { status: 400 });
  }
  try {
    const club = await kickMember(id, session.discordId, targetId);
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club: clubForClient(club, session.discordId), leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to kick." },
      { status: 400 }
    );
  }
}
