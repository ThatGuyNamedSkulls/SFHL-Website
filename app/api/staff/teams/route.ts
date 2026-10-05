import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffContext } from "@/lib/staff-session";
import { staffTeamsView } from "@/lib/staff-teams";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The Teams tab: every website team and its titles (Match Staff). */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.roles.staff) return NextResponse.json({ error: "Match Staff only." }, { status: 403 });
  try {
    return NextResponse.json(await staffTeamsView());
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the teams tab.") }, { status: 500 });
  }
}
