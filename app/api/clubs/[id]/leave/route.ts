import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clubLeaderboard, leaveClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const club = await leaveClub(id, session.discordId);
    if (!club) return NextResponse.json({ ok: true });
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club, leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to leave." },
      { status: 400 }
    );
  }
}
