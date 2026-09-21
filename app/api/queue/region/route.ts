import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setPlayerLastQueueRegion } from "@/lib/db";
import { isQueueRegion } from "@/lib/regions";

export const dynamic = "force-dynamic";

/** Remember the last matchmaking server this player picked. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { region?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const region = String(body.region || "").toUpperCase();
  if (!isQueueRegion(region)) {
    return NextResponse.json({ error: "Pick a matchmaking server" }, { status: 400 });
  }

  await setPlayerLastQueueRegion(session.playerName, region);
  return NextResponse.json({ ok: true, region });
}
