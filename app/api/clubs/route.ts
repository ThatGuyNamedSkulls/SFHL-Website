import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import { clubsForPlayer, createClub, listClubs, summarizeClub } from "@/lib/clubs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const player = new URL(request.url).searchParams.get("player")?.trim();
    const clubs = player ? await clubsForPlayer(player) : await listClubs();
    return NextResponse.json({
      count: clubs.length,
      clubs: clubs.map(summarizeClub),
    });
  } catch (error) {
    console.error("clubs GET", error);
    return NextResponse.json({ count: 0, clubs: [] });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to create a club." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = String(body.name ?? "");
  const description = String(body.description ?? "");
  const rules = String(body.rules ?? "");
  if (containsProfanity(`${name} ${description} ${rules}`)) {
    return NextResponse.json(
      { error: "Club name, description, or rules contain language that is not allowed." },
      { status: 400 }
    );
  }
  try {
    const club = await createClub({
      name,
      description,
      region: String(body.region ?? ""),
      rules,
      owner: {
        discordId: session.discordId,
        username: session.username,
        playerName: session.playerName,
        avatar: session.avatar,
      },
    });
    return NextResponse.json({ club }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create club." },
      { status: 400 }
    );
  }
}
