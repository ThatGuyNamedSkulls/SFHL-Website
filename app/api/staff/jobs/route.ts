import { NextResponse } from "next/server";
import { LIMITS, limited } from "@/lib/rate-limit";
import { publicErrorMessage } from "@/lib/route-errors";
import { StaffJobError, createStaffJob, listStaffJobs } from "@/lib/staff-jobs";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Recent staff actions done on the website (Match Staff / Admin). */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({ jobs: await listStaffJobs(30), roles: ctx.roles });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load recent actions.") }, { status: 500 });
  }
}

/** { kind, args } → queues the action for the bot; the page then polls /api/staff/jobs/:id. */
export async function POST(request: Request) {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  const limitHit = await limited(`staff:${ctx.actor.discordId}`, LIMITS.staffAction);
  if (limitHit) return limitHit;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const job = await createStaffJob(ctx.actor, ctx.roles, String(body.kind ?? ""), body.args);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof StaffJobError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't send that to the bot.") }, { status: 500 });
  }
}
