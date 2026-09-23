import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import {
  MAX_OWNED_TEAMS,
  createTeam,
  listTeams,
  summarizeTeam,
  teamsForMember,
  ownedTeamCount,
} from "@/lib/teams";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const mineOnly = new URL(request.url).searchParams.get("mine") === "1";
    const teams = mineOnly && session?.discordId
      ? await teamsForMember(session.discordId)
      : await listTeams();
    const mineId = session?.discordId ?? null;
    return NextResponse.json({
      maxOwned: MAX_OWNED_TEAMS,
      ownedCount: mineId ? await ownedTeamCount(mineId) : 0,
      teams: teams.map((team) => ({
        ...summarizeTeam(team),
        mine: mineId ? team.members.some((m) => m.discordId === mineId && m.status === "accepted") : false,
        captain: mineId ? team.captainId === mineId : false,
        pendingInvite: mineId
          ? team.members.some((m) => m.discordId === mineId && m.status === "invited")
          : false,
      })),
    });
  } catch (error) {
    console.error("teams GET", error);
    return NextResponse.json({ teams: [] });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to create a team." }, { status: 401 });
  }
  if (!session.playerName) {
    return NextResponse.json(
      { error: "Link a HyperLeague player to create a team." },
      { status: 400 }
    );
  }
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = String(body.name ?? "");
  const tag = String(body.tag ?? "");
  if (containsProfanity(`${name} ${tag}`)) {
    return NextResponse.json({ error: "Name or tag contains language that is not allowed." }, { status: 400 });
  }
  try {
    const team = await createTeam({
      name,
      tag,
      region: String(body.region ?? "EU"),
      logoUrl: body.logoUrl == null ? null : String(body.logoUrl),
      accentColor: String(body.accentColor ?? "#ff5500"),
      captain: {
        discordId: session.discordId,
        username: session.username || session.playerName,
        playerName: session.playerName,
        avatar: session.avatar ?? null,
      },
    });
    return NextResponse.json({ team });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create team." },
      { status: 400 }
    );
  }
}
