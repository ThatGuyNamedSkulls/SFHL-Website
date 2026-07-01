import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { joinParty } from "@/lib/parties";
import { memberFromSession } from "@/lib/party-member";

/** POST — join a party (requires auth). */
export async function POST(_request: Request, ctx: RouteContext<"/api/parties/[id]/join">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in to join a party" }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;
    const result = joinParty(id, await memberFromSession(session));
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ party: result });
  } catch (error) {
    console.error("Error joining party:", error);
    return NextResponse.json({ error: "Failed to join party" }, { status: 500 });
  }
}
