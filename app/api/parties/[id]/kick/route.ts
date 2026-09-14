import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { kickMember } from "@/lib/parties";

/** POST { discordId } — leader kicks a member. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({} as { discordId?: string }));
    const target = typeof body.discordId === "string" ? body.discordId : "";
    if (!target) {
      return NextResponse.json({ error: "Missing player" }, { status: 400 });
    }
    const result = await kickMember(id, session.discordId, target);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error kicking from party:", error);
    return NextResponse.json({ error: "Failed to kick" }, { status: 500 });
  }
}
