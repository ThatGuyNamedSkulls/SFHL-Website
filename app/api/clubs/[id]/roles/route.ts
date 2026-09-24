import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import {
  addClubRole,
  clubForClient,
  clubLeaderboard,
  deleteClubRole,
  getClub,
  setMemberRole,
  updateClubRole,
} from "@/lib/clubs";

export const dynamic = "force-dynamic";

async function ok(id: string, viewerId: string) {
  const club = await getClub(id);
  if (!club) return NextResponse.json({ error: "Clan not found." }, { status: 404 });
  const leaderboard = await clubLeaderboard(club);
  return NextResponse.json({ club: clubForClient(club, viewerId), leaderboard });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  try {
    if (typeof body.discordId === "string" && typeof body.roleId === "string") {
      await setMemberRole(id, session.discordId, body.discordId, body.roleId);
      return ok(id, session.discordId);
    }
    const name = String(body.name ?? "");
    if (containsProfanity(name)) {
      return NextResponse.json({ error: "Role name is not allowed." }, { status: 400 });
    }
    await addClubRole(id, session.discordId, {
      name,
      canInvite: !!body.canInvite,
      canKick: !!body.canKick,
      canPromote: !!body.canPromote,
      canEdit: !!body.canEdit,
    });
    return ok(id, session.discordId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update role." },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const roleId = String(body.roleId ?? "");
  if (!roleId) return NextResponse.json({ error: "Missing role." }, { status: 400 });
  if (typeof body.name === "string" && containsProfanity(body.name)) {
    return NextResponse.json({ error: "Role name is not allowed." }, { status: 400 });
  }
  try {
    await updateClubRole(id, session.discordId, roleId, {
      name: typeof body.name === "string" ? body.name : undefined,
      canInvite: typeof body.canInvite === "boolean" ? body.canInvite : undefined,
      canKick: typeof body.canKick === "boolean" ? body.canKick : undefined,
      canPromote: typeof body.canPromote === "boolean" ? body.canPromote : undefined,
      canEdit: typeof body.canEdit === "boolean" ? body.canEdit : undefined,
    });
    return ok(id, session.discordId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update role." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const roleId =
    new URL(request.url).searchParams.get("roleId") ||
    String((await request.json().catch(() => ({} as { roleId?: string }))).roleId ?? "");
  if (!roleId) return NextResponse.json({ error: "Missing role." }, { status: 400 });
  try {
    await deleteClubRole(id, session.discordId, roleId);
    return ok(id, session.discordId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete role." },
      { status: 400 }
    );
  }
}
