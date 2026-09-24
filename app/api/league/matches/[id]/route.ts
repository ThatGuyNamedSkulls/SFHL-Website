import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isMatchStaff } from "@/lib/discord-party-voice";
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
  staffReschedule,
  staffSetResult,
} from "@/lib/league-matches";
import { LeagueAdminError } from "@/lib/league-admin";
import { StatsInputError, deleteMapStats, matchScoreboards, saveMapStats } from "@/lib/league-stats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function matchId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** The match page payload plus its saved map scoreboards (step 9 stats). */
async function fullView(id: number, viewerId: string | null, staff: boolean) {
  const view = await leagueMatchView(id, viewerId, staff);
  return view ? { ...view, stats: await matchScoreboards(id, view.teamA.id) } : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = matchId((await params).id);
  const session = await getSession();
  const staff = session ? await isMatchStaff(session.discordId).catch(() => false) : false;
  const view = id === null ? null : await fullView(id, session?.discordId ?? null, staff);
  if (!view) return NextResponse.json({ error: "League match not found." }, { status: 404 });
  return NextResponse.json(view);
}

/**
 * Captains: { action, ... }
 *   propose {time}, accept, decline, report {scoreA, scoreB}, confirm,
 *   dispute {reason}, claimForfeit, concede
 * Match Staff: staffSetResult, staffReschedule, saveStats {mapNo, mapName, roundsA, roundsB, players},
 *   deleteStats {mapNo}
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const id = matchId((await params).id);
  if (id === null) return NextResponse.json({ error: "League match not found." }, { status: 404 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const me = session.discordId;
  const staffAction = ["staffSetResult", "staffReschedule", "saveStats", "deleteStats"].includes(String(body.action));
  const staff = await isMatchStaff(me).catch(() => false);
  if (staffAction && !staff) return NextResponse.json({ error: "Match Staff only." }, { status: 403 });
  const actor = { discordId: me, name: session.playerName || session.username };
  try {
    switch (body.action) {
      case "staffSetResult":
        await staffSetResult(
          id,
          {
            winner: String(body.winner ?? ""),
            scoreA: body.scoreA == null || body.scoreA === "" ? null : Number(body.scoreA),
            scoreB: body.scoreB == null || body.scoreB === "" ? null : Number(body.scoreB),
            forfeit: body.forfeit === true,
          },
          actor
        );
        break;
      case "staffReschedule":
        await staffReschedule(id, Number(body.time), actor);
        break;
      case "saveStats":
        await saveMapStats(id, body, actor);
        break;
      case "deleteStats":
        await deleteMapStats(id, Number(body.mapNo), actor);
        break;
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
    return NextResponse.json(await fullView(id, me, staff));
  } catch (error) {
    if (error instanceof LeagueActionError || error instanceof LeagueAdminError || error instanceof StatsInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("league match POST", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
