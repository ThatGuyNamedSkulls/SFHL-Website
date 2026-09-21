import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clubLeaderboard, joinClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to join a club." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const club = await joinClub(id, {
      discordId: session.discordId,
      username: session.username,
      playerName: session.playerName,
      avatar: session.avatar,
    });
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club, leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to join." },
      { status: 400 }
    );
  }
}
