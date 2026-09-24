import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  FindInputError,
  applyToTeam,
  decideApplication,
  deletePlayerPost,
  deleteTeamPost,
  messagePlayer,
  savePlayerPost,
  saveTeamPost,
  withdrawApplication,
  type Viewer,
} from "@/lib/league-find";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Find Teammates board actions (docs/LEAGUE_UI_PLAN.md step 7):
 * { action, seasonId, ... } — saveTeamPost / deleteTeamPost (teamId, post),
 * savePlayerPost / deletePlayerPost (post), apply (teamId, message),
 * withdraw / decide (applicationId, accept), message (postId, message).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const viewer: Viewer = {
    discordId: session.discordId,
    playerName: session.playerName ?? null,
    username: session.discordUsername || session.username,
    avatar: session.avatar ?? null,
  };
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const seasonId = Number(body.seasonId);
  const teamId = String(body.teamId ?? "");
  const post = (body.post && typeof body.post === "object" ? body.post : {}) as Record<string, unknown>;

  try {
    switch (body.action) {
      case "saveTeamPost":
        await saveTeamPost(seasonId, teamId, viewer, post);
        break;
      case "deleteTeamPost":
        await deleteTeamPost(seasonId, teamId, viewer);
        break;
      case "savePlayerPost":
        await savePlayerPost(seasonId, viewer, post);
        break;
      case "deletePlayerPost":
        await deletePlayerPost(seasonId, viewer);
        break;
      case "apply":
        await applyToTeam(seasonId, teamId, viewer, body.message);
        break;
      case "withdraw":
        await withdrawApplication(Number(body.applicationId), viewer);
        break;
      case "decide":
        await decideApplication(Number(body.applicationId), viewer, body.accept === true);
        break;
      case "message":
        await messagePlayer(seasonId, Number(body.postId), viewer, body.message);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Rule errors (and team rule errors from lib/teams) are safe to show; anything else is logged.
    if (error instanceof FindInputError || (error instanceof Error && !/SQLITE|libsql/i.test(error.message))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("league find POST", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
