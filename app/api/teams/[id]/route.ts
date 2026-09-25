import { NextResponse } from "next/server";
import { titlesForTeam } from "@/lib/team-titles";
import { accessLabel, teamAccessMap, teamLeagueHistory, teamLeagueStatus } from "@/lib/league";
import { isMatchStaff } from "@/lib/discord-party-voice";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import { client } from "@/lib/db";
import { ensurePlayerDiscordColumns } from "@/lib/db";
import {
  deleteTeam,
  getTeam,
  inviteToTeam,
  kickFromTeam,
  leaveTeam,
  patchTeam,
  respondToInvite,
  setMemberRole,
  transferCaptain,
  type TeamRole,
} from "@/lib/teams";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function findPlayerByName(name: string) {
  await ensurePlayerDiscordColumns();
  const rs = await client.execute({
    sql: `SELECT discord_id, name, discord_username, discord_avatar, roblox_avatar_image
          FROM players WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    args: [name.trim()],
  });
  const row = rs.rows[0];
  if (!row?.discord_id) return null;
  return {
    discordId: String(row.discord_id),
    playerName: String(row.name),
    username: String(row.discord_username || row.name),
    avatar: (row.roblox_avatar_image || row.discord_avatar || null) as string | null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  const titles = await titlesForTeam(id).catch(() => []);
  const league = await teamLeagueHistory(id).catch(() => []);
  const access = (await teamAccessMap([id]).catch(() => new Map<string, string>())).get(id) ?? null;
  const leagueStatus = await teamLeagueStatus(team).catch(() => null);
  const viewer = await getSession();
  const staff = viewer ? await isMatchStaff(viewer.discordId).catch(() => false) : false;
  return NextResponse.json({
    team,
    titles,
    league,
    // Invite-only named divisions: "Main Access", or null when the team plays in Open by skill.
    leagueAccess: access ? { code: access, label: accessLabel(access) } : null,
    // Where it plays next season: its status, or its Open band by skill (league v2 C4).
    leagueStatus,
    staff,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || "");

  try {
    if (action === "invite") {
      const playerName = String(body.playerName || "").trim();
      if (!playerName) return NextResponse.json({ error: "Player name required." }, { status: 400 });
      const invitee = await findPlayerByName(playerName);
      if (!invitee) return NextResponse.json({ error: "No linked player with that name." }, { status: 404 });
      const slot = body.slot === "starter" || body.slot === "sub" || body.slot === "coach" ? body.slot : undefined;
      const team = await inviteToTeam(id, session.discordId, invitee, slot);
      return NextResponse.json({ team });
    }
    if (action === "respond") {
      const accept = !!body.accept;
      const team = await respondToInvite(id, session.discordId, accept);
      return NextResponse.json({ team, ok: true });
    }
    if (action === "kick") {
      const team = await kickFromTeam(id, session.discordId, String(body.discordId || ""));
      return NextResponse.json({ team });
    }
    if (action === "slot") {
      const role = String(body.role || "") as TeamRole;
      if (role !== "starter" && role !== "sub" && role !== "coach") {
        return NextResponse.json({ error: "Role must be main roster, sub or coach." }, { status: 400 });
      }
      const team = await setMemberRole(id, session.discordId, String(body.discordId || ""), role);
      return NextResponse.json({ team });
    }
    if (action === "leave") {
      const team = await leaveTeam(id, session.discordId);
      return NextResponse.json({ team, ok: true });
    }
    if (action === "transfer") {
      const team = await transferCaptain(id, session.discordId, String(body.discordId || ""));
      return NextResponse.json({ team });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed." },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = body.name == null ? undefined : String(body.name);
  const tag = body.tag == null ? undefined : String(body.tag);
  const description = body.description === undefined ? undefined : body.description == null ? null : String(body.description);
  if (containsProfanity(`${name || ""} ${tag || ""}`)) {
    return NextResponse.json({ error: "Name or tag not allowed." }, { status: 400 });
  }
  if (description && containsProfanity(description)) {
    return NextResponse.json({ error: "Please keep the description friendly." }, { status: 400 });
  }
  try {
    const team = await patchTeam(id, session.discordId, {
      name,
      tag,
      logoUrl: body.logoUrl === undefined ? undefined : body.logoUrl == null ? null : String(body.logoUrl),
      bannerUrl: body.bannerUrl === undefined ? undefined : body.bannerUrl == null ? null : String(body.bannerUrl),
      description,
      accentColor: body.accentColor == null ? undefined : String(body.accentColor),
      region: body.region == null ? undefined : String(body.region),
    });
    return NextResponse.json({ team });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const { id } = await params;
  try {
    await deleteTeam(id, session.discordId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed." },
      { status: 400 }
    );
  }
}
