import { NextResponse } from "next/server";
import { setReportHandled } from "@/lib/reports";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";

/** { handled: true | false } → mark a player report handled, or open it again (Match Staff). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.roles.staff) return NextResponse.json({ error: "Match Staff only." }, { status: 403 });
  const raw = (await params).id;
  if (!/^\d{1,12}$/.test(raw)) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { handled?: unknown };
  try {
    const ok = await setReportHandled(Number(raw), body.handled !== false, ctx.actor.name);
    if (!ok) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't update the report.") }, { status: 500 });
  }
}
