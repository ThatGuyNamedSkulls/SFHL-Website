import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { clanPayload } from "@/lib/clan-payload";
import {
  cancelJoinRequest,
  notifyJoinRequest,
  requestToJoin,
} from "@/lib/clubs";

export const dynamic = "force-dynamic";

/** Ask to join an invite-only clan. The owner and roles that can invite are notified. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to ask to join a clan." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  try {
    const requester = {
      discordId: session.discordId,
      username: session.username,
      playerName: session.playerName,
      avatar: session.avatar,
    };
    const { club, created } = await requestToJoin(id, requester);
    if (created) {
      try {
        await notifyJoinRequest(club, { ...requester, createdAt: Date.now() });
      } catch (error) {
        console.error("clan join request notify", error);
      }
    }
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to send the request.") },
      { status: 400 }
    );
  }
}

/** Take back your own pending request. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  try {
    const club = await cancelJoinRequest(id, session.discordId);
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to cancel the request.") },
      { status: 400 }
    );
  }
}
