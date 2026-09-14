import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyWebsiteMapBan } from "@/lib/lobby";

/** POST { map } — captain bans a map from the website match room. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  let map = "";
  try {
    const body = await req.json();
    map = String(body?.map ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!map) {
    return NextResponse.json({ error: "Map is required" }, { status: 400 });
  }

  const result = await applyWebsiteMapBan(session.discordId, map);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ lobby: result.lobby });
}
