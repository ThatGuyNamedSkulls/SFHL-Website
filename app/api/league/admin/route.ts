import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isMatchStaff, listGuildTextChannels } from "@/lib/discord-party-voice";
import {
  LeagueAdminError,
  adminView,
  cancelSeason,
  closeSignups,
  createSeason,
  moveTeam,
  openSignups,
  previewDraw,
  previewStart,
  removeEntry,
  setLeagueChannel,
  startSeason,
  type Actor,
} from "@/lib/league-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function staffActor(): Promise<Actor | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  if (!(await isMatchStaff(session.discordId).catch(() => false))) {
    return NextResponse.json({ error: "Match Staff only." }, { status: 403 });
  }
  return { discordId: session.discordId, name: session.playerName || session.username };
}

/** The Manage tab: the running season, sign-ups, divisions, "needs staff", audit log. */
export async function GET(request: Request) {
  const actor = await staffActor();
  if (actor instanceof NextResponse) return actor;
  const url = new URL(request.url);
  if (url.searchParams.get("channels") === "1") {
    return NextResponse.json({ channels: await listGuildTextChannels() });
  }
  const raw = url.searchParams.get("season");
  return NextResponse.json(await adminView(raw && /^\d+$/.test(raw) ? Number(raw) : null));
}

/**
 * Match Staff: { action, seasonId, ... }
 *   create {name} · openSignups {days} · previewDraw · closeSignups · moveTeam {teamId, divisionId}
 *   removeEntry {teamId} · previewStart {firstWeek} · start {firstWeek} · cancel {confirmName}
 *   setChannel {channelId, channelName}
 */
export async function POST(request: Request) {
  const actor = await staffActor();
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const seasonId = Number(body.seasonId);
  try {
    let result: unknown = null;
    switch (body.action) {
      case "create":
        result = await createSeason(String(body.name ?? ""), actor);
        break;
      case "openSignups":
        await openSignups(seasonId, Number(body.days ?? 7), actor);
        break;
      case "previewDraw":
        return NextResponse.json({ preview: await previewDraw(seasonId) });
      case "closeSignups":
        result = await closeSignups(seasonId, actor);
        break;
      case "moveTeam":
        await moveTeam(seasonId, String(body.teamId ?? ""), Number(body.divisionId), actor);
        break;
      case "removeEntry":
        await removeEntry(seasonId, String(body.teamId ?? ""), actor);
        break;
      case "previewStart":
        return NextResponse.json({ preview: await previewStart(seasonId, String(body.firstWeek ?? "")) });
      case "start":
        result = await startSeason(seasonId, String(body.firstWeek ?? ""), actor);
        break;
      case "cancel":
        await cancelSeason(seasonId, String(body.confirmName ?? ""), actor);
        break;
      case "setChannel":
        await setLeagueChannel(String(body.channelId ?? ""), String(body.channelName ?? ""), actor);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof LeagueAdminError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("league admin POST", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
