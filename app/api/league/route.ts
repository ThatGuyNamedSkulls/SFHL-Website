import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { leagueView, signUpTeam, withdrawTeam } from "@/lib/league";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The league page: a season (default: the running one), divisions, standings, schedule. */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const raw = new URL(request.url).searchParams.get("season");
    const seasonId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    const [view, staff] = await Promise.all([
      leagueView(seasonId, session?.discordId ?? null),
      session ? isMatchStaff(session.discordId).catch(() => false) : Promise.resolve(false),
    ]);
    return NextResponse.json({ ...view, staff });
  } catch (error) {
    console.error("league GET", error);
    return NextResponse.json({ error: "Failed to load the league." }, { status: 500 });
  }
}

/** Captains: { action: "signup" | "withdraw", teamId }. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const teamId = String(body.teamId ?? "");
  try {
    if (body.action === "signup") await signUpTeam(teamId, session.discordId);
    else if (body.action === "withdraw") await withdrawTeam(teamId, session.discordId);
    else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
