import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffSeasonView } from "@/lib/staff-season";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The Season tab: this season's Top 10, how it went, past seasons (any staff can look). */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json(await staffSeasonView());
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the season tab.") }, { status: 500 });
  }
}
