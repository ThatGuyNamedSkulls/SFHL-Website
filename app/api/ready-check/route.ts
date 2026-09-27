import { NextResponse } from "next/server";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { acceptReadyCheck, myReadyCheck } from "@/lib/ready-checks";
import { getWebQueueJoinedAt } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET — the signed-in player's current (or just-finished) ready check, and
 * whether they're queued (the popup polls fast only while queued or pending).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ check: null, queued: false, queuedSince: null });
  try {
    const [check, queuedSince] = await Promise.all([
      myReadyCheck(session.discordId),
      getWebQueueJoinedAt(session.discordId),
    ]);
    // queuedSince drives the search timer and the tab title while you wait.
    return NextResponse.json({ check, queued: queuedSince !== null, queuedSince });
  } catch (error) {
    console.error("ready-check GET", error);
    return NextResponse.json({ check: null, queued: false, queuedSince: null });
  }
}

const MESSAGES: Record<string, string> = {
  not_in_check: "This match isn't yours.",
  closed: "This ready check is already over.",
  expired: "Too late — the 20 seconds ran out.",
};

/** POST { id } — accept the match. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const limitHit = await limited(`general:${session.discordId}`, LIMITS.general);
  if (limitHit) return limitHit;
  const body = await request.json().catch(() => ({} as { id?: string }));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing ready check." }, { status: 400 });
  try {
    const result = await acceptReadyCheck(id, session.discordId);
    if (result === "accepted" || result === "already") {
      return NextResponse.json({ ok: true, check: await myReadyCheck(session.discordId) });
    }
    return NextResponse.json({ error: MESSAGES[result] }, { status: 409 });
  } catch (error) {
    console.error("ready-check POST", error);
    return NextResponse.json({ error: "Could not accept." }, { status: 500 });
  }
}
