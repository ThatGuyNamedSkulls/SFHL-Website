import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { clanPayload } from "@/lib/clan-payload";
import { joinClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to join a clan." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
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
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to join.") },
      { status: 400 }
    );
  }
}
