import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLobbyForUser } from "@/lib/lobby";

/** GET — the active post-queue lobby (match) the logged-in user is in, or null.
 *  Written by the bot when a queue fills; read-only here. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ lobby: null });
  try {
    const lobby = await getLobbyForUser(session.discordId);
    return NextResponse.json({ lobby });
  } catch (error) {
    console.error("Error fetching lobby:", error);
    return NextResponse.json({ lobby: null });
  }
}
