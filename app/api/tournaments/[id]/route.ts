import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClub } from "@/lib/clubs";
import { isMatchStaff } from "@/lib/discord-party-voice";
import {
  assignCaptain,
  cancelTournament,
  getTournament,
  invitePlayer,
  kickRoster,
  presentTournament,
  reportMatch,
  requestJoin,
  respondInvite,
  reviewRequest,
  setRosterSlot,
  startTournament,
  tournamentViewer,
  withdrawTeam,
  type TournamentActor,
} from "@/lib/tournaments";
import type { Tournament } from "@/lib/tournament-types";

export const dynamic = "force-dynamic";

async function actor(): Promise<TournamentActor | null> {
  const session = await getSession();
  if (!session) return null;
  const staff = await isMatchStaff(session.discordId).catch(() => false);
  return {
    discordId: session.discordId,
    username: session.username,
    playerName: session.playerName,
    avatar: session.avatar,
    staff,
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed";
  return NextResponse.json({ error: message }, { status: 400 });
}

async function payload(t: Tournament, me: TournamentActor | null) {
  const viewer = await tournamentViewer(t, me);
  const clubName = t.clubId ? (await getClub(t.clubId))?.name ?? null : null;
  return {
    tournament: presentTournament(t, me, viewer.organizer),
    viewer,
    clubName,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = await getTournament(id);
  if (!t) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const me = await actor();
  return NextResponse.json(await payload(t, me));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await actor();
  if (!me) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || "");
  try {
    let t: Tournament;
    switch (action) {
      case "request":
        t = await requestJoin(id, me, String(body.teamId ?? ""));
        break;
      case "review":
        t = await reviewRequest(id, me, String(body.requestId ?? ""), !!body.accept);
        break;
      case "assignCaptain":
        t = await assignCaptain(
          id,
          me,
          String(body.playerName ?? ""),
          String(body.teamRef ?? body.teamName ?? "")
        );
        break;
      case "invite":
        t = await invitePlayer(id, me, String(body.teamId ?? ""), String(body.playerName ?? ""));
        break;
      case "respond":
        t = await respondInvite(id, me, String(body.teamId ?? ""), !!body.accept);
        break;
      case "kick":
        t = await kickRoster(id, me, String(body.teamId ?? ""), String(body.discordId ?? ""));
        break;
      case "slot":
        t = await setRosterSlot(
          id,
          me,
          String(body.teamId ?? ""),
          String(body.discordId ?? ""),
          String(body.slot ?? "")
        );
        break;
      case "withdraw":
        t = await withdrawTeam(id, me, String(body.teamId ?? ""));
        break;
      case "start":
        t = await startTournament(id, me);
        break;
      case "report":
        t = await reportMatch(id, me, String(body.matchId ?? ""), body.scores);
        break;
      case "cancel":
        t = await cancelTournament(id, me);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json(await payload(t, me));
  } catch (error) {
    return fail(error);
  }
}
