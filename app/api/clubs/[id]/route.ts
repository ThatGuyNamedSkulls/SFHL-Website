import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import { clubLeaderboard, deleteClub, getClub, updateClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const club = await getClub(id);
  if (!club) return NextResponse.json({ error: "Club not found." }, { status: 404 });
  let leaderboard: Awaited<ReturnType<typeof clubLeaderboard>> = [];
  try {
    leaderboard = await clubLeaderboard(club);
  } catch (error) {
    console.error("club leaderboard", error);
  }
  return NextResponse.json({ club, leaderboard });
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
  if (containsProfanity(`${name ?? ""} ${tag ?? ""} ${description ?? ""} ${rules ?? ""}`)) {
    return NextResponse.json(
      { error: "Name, tag, description, or rules contain language that is not allowed." },
      { status: 400 }
    );
  }
  try {
    const club = await updateClub(id, session.discordId, {
      name,
      description,
      rules,
      tag,
      accentColor,
      logoUrl,
    });
    const leaderboard = await clubLeaderboard(club);
    return NextResponse.json({ club, leaderboard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update club." },
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
      { error: error instanceof Error ? error.message : "Failed to delete club." },
      { status: 400 }
    );
  }
}
