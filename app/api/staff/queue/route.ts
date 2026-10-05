import { NextResponse } from "next/server";
import { listGuildTextChannels } from "@/lib/discord-party-voice";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffQueueView } from "@/lib/staff-queue";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The Queue tab: each region's queue, the format, live matches. ?channels=1 adds the server's text channels. */
export async function GET(request: Request) {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.roles.staff) return NextResponse.json({ error: "Match Staff only." }, { status: 403 });
  try {
    const wantChannels = new URL(request.url).searchParams.get("channels") === "1";
    const [view, channels] = await Promise.all([
      staffQueueView(),
      wantChannels ? listGuildTextChannels() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...view, ...(channels ? { channels } : {}) });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the queue tab.") }, { status: 500 });
  }
}
