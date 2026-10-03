import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { clanPayload } from "@/lib/clan-payload";
import { createInvite, revokeInvite } from "@/lib/clubs";

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
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to create invite.") },
      { status: 400 }
    );
  }
}

/** DELETE ?token= — turn off one invite link. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) return NextResponse.json({ error: "Missing invite link." }, { status: 400 });
  try {
    const club = await revokeInvite(id, session.discordId, token);
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to remove the link.") },
      { status: 400 }
    );
  }
}
