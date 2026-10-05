import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffPlayerView } from "@/lib/staff-players";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** One player as the staff panel shows them: account, ban, timeouts, leaves, badges, items. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  const raw = (await params).name || "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* a stray "%": use it as typed */
  }
  name = name.trim().slice(0, 64);
  if (!name) return NextResponse.json({ error: "Player not found." }, { status: 404 });
  try {
    const view = await staffPlayerView(name);
    if (!view) return NextResponse.json({ error: "Player not found." }, { status: 404 });
    return NextResponse.json(view);
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load that player.") }, { status: 500 });
  }
}
