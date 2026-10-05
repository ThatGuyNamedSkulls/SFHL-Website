import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffModerationView } from "@/lib/staff-moderation";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The Moderation tab: reports, recent timeouts, early leaves, who is suspended now (Match Staff). */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.roles.staff) return NextResponse.json({ error: "Match Staff only." }, { status: 403 });
  try {
    return NextResponse.json(await staffModerationView());
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the moderation tab.") }, { status: 500 });
  }
}
