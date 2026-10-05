import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { cancelStaffJob, getStaffJob } from "@/lib/staff-jobs";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jobId(raw: string): number | null {
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null;
}

/** One action's status and result (the page asks every second while the bot works). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  const id = jobId((await params).id);
  try {
    const job = id === null ? null : await getStaffJob(id);
    if (!job) return NextResponse.json({ error: "Action not found." }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load that action.") }, { status: 500 });
  }
}

/** Stop waiting: cancels the action if the bot hasn't started it (your own actions only). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  const id = jobId((await params).id);
  try {
    const job = id === null ? null : await cancelStaffJob(id, ctx.actor.discordId);
    if (!job) return NextResponse.json({ error: "Action not found." }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't cancel that action.") }, { status: 500 });
  }
}
