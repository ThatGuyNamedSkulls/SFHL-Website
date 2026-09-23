import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOnline, touchPresence } from "@/lib/presence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function list(value: string | null): string[] {
  return value ? value.split(",") : [];
}

/** GET ?names=a,b&ids=1,2 — which of these players have the site open. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const online = await getOnline({
      names: list(url.searchParams.get("names")),
      ids: list(url.searchParams.get("ids")),
    });
    return NextResponse.json(online);
  } catch (error) {
    console.error("presence GET", error);
    return NextResponse.json({ names: [], ids: [] });
  }
}

/** POST — heartbeat from an open, visible tab. ?leave=1 marks the user
 *  offline (sent with navigator.sendBeacon when the tab closes). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const leave = new URL(request.url).searchParams.get("leave") === "1";
  try {
    await touchPresence(session.discordId, session.playerName ?? null, leave);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("presence POST", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
