import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  LeagueActionError,
  acceptTime,
  claimForfeit,
  concede,
  confirmResult,
  declineTime,
  disputeResult,
  leagueMatchView,
  proposeTime,
  reportScore,
} from "@/lib/league-matches";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function matchId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = matchId((await params).id);
  const session = await getSession();
  const view = id === null ? null : await leagueMatchView(id, session?.discordId ?? null);
  if (!view) return NextResponse.json({ error: "League match not found." }, { status: 404 });
  return NextResponse.json(view);
}

/**
 * Captains: { action, ... }
 *   propose {time}, accept, decline, report {scoreA, scoreB}, confirm,
 *   dispute {reason}, claimForfeit, concede
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const id = matchId((await params).id);
  if (id === null) return NextResponse.json({ error: "League match not found." }, { status: 404 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const me = session.discordId;
  try {
    switch (body.action) {
      case "propose":
        await proposeTime(id, me, Number(body.time));
        break;
      case "accept":
        await acceptTime(id, me);
        break;
      case "decline":
        await declineTime(id, me);
        break;
      case "report":
        await reportScore(id, me, Number(body.scoreA), Number(body.scoreB));
        break;
      case "confirm":
        await confirmResult(id, me);
        break;
      case "dispute":
        await disputeResult(id, me, String(body.reason ?? ""));
        break;
      case "claimForfeit":
        await claimForfeit(id, me);
        break;
      case "concede":
        await concede(id, me);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json(await leagueMatchView(id, me));
  } catch (error) {
    if (error instanceof LeagueActionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("league match POST", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
