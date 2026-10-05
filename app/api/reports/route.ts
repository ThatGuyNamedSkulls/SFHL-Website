import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { LIMITS, limited } from "@/lib/rate-limit";
import { ReportError, createReport } from "@/lib/reports";
import { publicErrorMessage } from "@/lib/route-errors";

export const dynamic = "force-dynamic";

/** { player, reason } → report a player to staff (like /mod report in Discord). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in to report a player." }, { status: 401 });
  const limitHit = await limited(`report:${session.discordId}`, LIMITS.report, "You've sent a lot of reports. Try again later.");
  if (limitHit) return limitHit;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const done = await createReport(
      { discordId: session.discordId, name: session.playerName || session.username },
      String(body.player ?? ""),
      String(body.reason ?? "")
    );
    return NextResponse.json({ ok: true, reported: done.reported });
  } catch (error) {
    if (error instanceof ReportError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't send the report.") }, { status: 500 });
  }
}
