import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { containsProfanity } from "@/lib/content-moderation";
import {
  CLUB_CREATE_COST,
  MAX_OWNED_CLUBS,
  clubsForPlayer,
  createClub,
  listClubs,
  ownedClubCount,
  summarizeClub,
} from "@/lib/clubs";
import { refundPlayerCoins, spendPlayerCoins } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const player = new URL(request.url).searchParams.get("player")?.trim();
    const clubs = player ? await clubsForPlayer(player) : await listClubs();
    const mineId = session?.discordId ?? null;
    return NextResponse.json({
      count: clubs.length,
      createCost: CLUB_CREATE_COST,
      maxOwned: MAX_OWNED_CLUBS,
      ownedCount: mineId ? await ownedClubCount(mineId) : 0,
      clubs: clubs.map((club) => ({
        ...summarizeClub(club),
        mine: mineId ? club.members.some((m) => m.discordId === mineId) : false,
      })),
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
  if (!session.playerName) {
    return NextResponse.json(
      { error: "Link a HyperLeague player to spend coins and create a club." },
      { status: 400 }
    );
  }
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = String(body.name ?? "");
  const tag = String(body.tag ?? "");
  const description = String(body.description ?? "");
  const rules = String(body.rules ?? "");
  if (containsProfanity(`${name} ${tag} ${description} ${rules}`)) {
    return NextResponse.json(
      { error: "Club name, tag, description, or rules contain language that is not allowed." },
      { status: 400 }
    );
  }
  if ((await ownedClubCount(session.discordId)) >= MAX_OWNED_CLUBS) {
    return NextResponse.json(
      { error: `You can own at most ${MAX_OWNED_CLUBS} clubs.` },
      { status: 400 }
    );
  }
  const spend = await spendPlayerCoins(session.playerName, CLUB_CREATE_COST);
  if (!spend.ok) {
    return NextResponse.json(
      { error: `Creating a club costs ${CLUB_CREATE_COST.toLocaleString()} HL Coins.`, coins: spend.coins },
      { status: 400 }
    );
  }
  try {
    const club = await createClub({
      name,
      tag,
      accentColor: String(body.accentColor ?? ""),
      logoUrl: body.logoUrl == null ? null : String(body.logoUrl),
      description,
      region: String(body.region ?? ""),
      rules,
      private: !!body.private,
      owner: {
        discordId: session.discordId,
        username: session.username,
        playerName: session.playerName,
        avatar: session.avatar,
      },
    });
    return NextResponse.json({ club, coins: spend.coins }, { status: 201 });
  } catch (error) {
    await refundPlayerCoins(session.playerName, CLUB_CREATE_COST).catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create club." },
      { status: 400 }
    );
  }
}
