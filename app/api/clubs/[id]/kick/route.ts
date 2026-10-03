import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { clanPayload } from "@/lib/clan-payload";
import { kickMember } from "@/lib/clubs";

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
    return NextResponse.json({ error: "Missing member." }, { status: 400 });
  }
  try {
    const club = await kickMember(id, session.discordId, targetId);
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to kick.") },
      { status: 400 }
    );
  }
}
