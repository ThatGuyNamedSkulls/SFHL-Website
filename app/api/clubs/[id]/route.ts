import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { LIMITS, limited } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import { clanPayload } from "@/lib/clan-payload";
import { deleteClub, getClub, getClubByIdOrTag, updateClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/clubs/<id or TAG> — the clan page's data (docs/CLANS_UI_PLAN.md §5). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  const club = await getClubByIdOrTag(decodeURIComponent(id));
  if (!club) return NextResponse.json({ error: "Clan not found." }, { status: 404 });
  return NextResponse.json(await clanPayload(club, session?.discordId));
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
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
    const club = await getClub(id);
    if (!club) return NextResponse.json({ error: "Clan not found." }, { status: 404 });
    return NextResponse.json(await clanPayload(club, session.discordId));
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to update clan.") },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in first." }, { status: 401 });
  }
  const limitHit = await limited(`groupWrite:${session.discordId}`, LIMITS.groupWrite);
  if (limitHit) return limitHit;
  const { id } = await ctx.params;
  try {
    await deleteClub(id, session.discordId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Failed to delete clan.") },
      { status: 400 }
    );
  }
}
