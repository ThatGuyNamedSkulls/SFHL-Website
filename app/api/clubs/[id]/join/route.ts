import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clubForClient, clubLeaderboard, joinClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to join a clan." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as { invite?: string }));
  const invite =
    typeof body.invite === "string"
      ? body.invite
      : new URL(request.url).searchParams.get("invite") || undefined;
  try {
    const club = await joinClub(
      id,
      {
        discordId: session.discordId,
        username: session.username,
        playerName: session.playerName,
        avatar: session.avatar,
      },
      invite
    );
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club: clubForClient(club, session.discordId), leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to join." },
      { status: 400 }
    );
  }
}
