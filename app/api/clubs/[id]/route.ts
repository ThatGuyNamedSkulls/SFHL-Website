import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import {
  clubForClient,
  clubLeaderboard,
  clubTagIndex,
  deleteClub,
  getClub,
  lookupClubTag,
  updateClub,
} from "@/lib/clubs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function payload(clubId: string, viewerId?: string | null) {
  const club = await getClub(clubId);
  if (!club) return null;
  let leaderboard: Awaited<ReturnType<typeof clubLeaderboard>> = [];
  try {
    leaderboard = await clubLeaderboard(club);
  } catch (error) {
    console.error("clan leaderboard", error);
  }
  const tags = await clubTagIndex();
  const clientClub = clubForClient(club, viewerId);
  return {
    club: {
      ...clientClub,
      members: clientClub.members.map((member) => ({
        ...member,
        clubTag: lookupClubTag(tags, member.playerName, member.discordId),
      })),
    },
    leaderboard: leaderboard.map((row) => ({
      ...row,
      clubTag: lookupClubTag(tags, row.playerName, row.discordId),
    })),
  };
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  const data = await payload(id, session?.discordId);
  if (!data) return NextResponse.json({ error: "Clan not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = typeof body.name === "string" ? body.name : undefined;
  const description = typeof body.description === "string" ? body.description : undefined;
  const rules = typeof body.rules === "string" ? body.rules : undefined;
  const tag = typeof body.tag === "string" ? body.tag : undefined;
  const accentColor = typeof body.accentColor === "string" ? body.accentColor : undefined;
  const logoUrl =
    body.logoUrl === null ? null : typeof body.logoUrl === "string" ? body.logoUrl : undefined;
  const isPrivate = typeof body.private === "boolean" ? body.private : undefined;
  if (containsProfanity(`${name ?? ""} ${tag ?? ""} ${description ?? ""} ${rules ?? ""}`)) {
    return NextResponse.json(
      { error: "Name, tag, description, or rules contain language that is not allowed." },
      { status: 400 }
    );
  }
  try {
    await updateClub(id, session.discordId, {
      name,
      description,
      rules,
      tag,
      accentColor,
      logoUrl,
      private: isPrivate,
    });
    const data = await payload(id, session.discordId);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update clan." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    await deleteClub(id, session.discordId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete clan." },
      { status: 400 }
    );
  }
}
