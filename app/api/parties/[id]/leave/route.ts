import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { leaveParty } from "@/lib/parties";

/** DELETE — leave a party (requires auth). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/parties/[id]/leave">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;
    const parties = leaveParty(id, session.discordId);
    return NextResponse.json({ parties, count: parties.length });
  } catch (error) {
    console.error("Error leaving party:", error);
    return NextResponse.json({ error: "Failed to leave party" }, { status: 500 });
  }
}
