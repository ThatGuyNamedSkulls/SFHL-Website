import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffRankingView } from "@/lib/staff-ranking";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The Ranking tab: live matches to rank into, the latest ranked matches, the Elo boost. */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json(await staffRankingView());
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the ranking tab.") }, { status: 500 });
  }
}
