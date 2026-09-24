import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClub } from "@/lib/clubs";
import { isMatchStaff } from "@/lib/discord-party-voice";
import {
  createTournament,
  listTournaments,
  summarizeTournament,
  tournamentsForClub,
  viewerInTournament,
  type TournamentActor,
} from "@/lib/tournaments";

export const dynamic = "force-dynamic";

async function actor(): Promise<TournamentActor | null> {
  const session = await getSession();
  if (!session) return null;
  const staff = await isMatchStaff(session.discordId).catch(() => false);
  return {
    discordId: session.discordId,
    username: session.username,
    playerName: session.playerName,
    avatar: session.avatar,
    staff,
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed";
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const me = await actor();
    const clubId = new URL(request.url).searchParams.get("clubId")?.trim();
    const rows = clubId ? await tournamentsForClub(clubId) : await listTournaments();
    const clubNames = new Map<string, string>();
    for (const t of rows) {
      if (!t.clubId || clubNames.has(t.clubId)) continue;
      const club = await getClub(t.clubId).catch(() => null);
      if (club) clubNames.set(t.clubId, club.name);
    }
    return NextResponse.json({
      staff: !!me?.staff,
      tournaments: rows.map((t) => ({
        ...summarizeTournament(t),
        organizer: t.kind === "official" ? "HyperLeague" : clubNames.get(t.clubId || "") || "Clan",
        mine: viewerInTournament(t, me?.discordId),
      })),
    });
  } catch (error) {
    console.error("tournaments GET", error);
    return NextResponse.json({ staff: false, tournaments: [] });
  }
}

export async function POST(request: Request) {
  const me = await actor();
  if (!me) return NextResponse.json({ error: "Log in to create a cup." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const tournament = await createTournament(
      {
        name: String(body.name ?? ""),
        kind: body.kind === "community" ? "community" : "official",
        clubId: body.clubId == null ? null : String(body.clubId),
        region: String(body.region ?? ""),
        bracket: String(body.bracket ?? ""),
        size: Number(body.size),
        bo: Number(body.bo),
        entryFee: Number(body.entryFee),
        potSplit: Array.isArray(body.potSplit) ? body.potSplit.map(Number) : null,
        mapPool: Array.isArray(body.mapPool) ? body.mapPool.map(String) : [],
      },
      me
    );
    return NextResponse.json({ tournament }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
