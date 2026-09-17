import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyWebsiteSidePick } from "@/lib/lobby";

/** POST { side } — captain picks CT/T from the website match room. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  let side = "";
  try {
    const body = await req.json();
    side = String(body?.side ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!side) {
    return NextResponse.json({ error: "Side is required" }, { status: 400 });
  }

  const result = await applyWebsiteSidePick(session.discordId, side);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ lobby: result.lobby });
}
