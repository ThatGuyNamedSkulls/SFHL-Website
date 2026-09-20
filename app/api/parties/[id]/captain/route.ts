import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { transferLeader } from "@/lib/parties";

/** POST { discordId } — captain hands the party to another member. */
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
    const result = await transferLeader(id, session.discordId, target);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error transferring party captain:", error);
    return NextResponse.json({ error: "Failed to transfer captain" }, { status: 500 });
  }
}
