import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  HIDE_CLUB_TAG_ID,
  clubTagIndex,
  clubsForMember,
  getClub,
  getClubTagPref,
  lookupClubTag,
  setClubTagPref,
  summarizeClub,
} from "@/lib/clubs";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to choose a clan tag." }, { status: 401 });
  }
  const clubs = await clubsForMember(session.discordId);
  const pref = await getClubTagPref(session.discordId);
  const tags = await clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} }));
  return NextResponse.json({
    activeClubId: pref,
    displayedTag: lookupClubTag(tags, session.playerName, session.discordId),
    clubs: clubs.map(summarizeClub),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in to choose a clan tag." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as { clubId?: unknown }));
  const raw = body.clubId == null ? "" : String(body.clubId).trim();
  const clubId = raw.toLowerCase() === "auto" ? "" : raw;

  if (!clubId) {
    await setClubTagPref(session.discordId, null);
  } else if (clubId === HIDE_CLUB_TAG_ID) {
    await setClubTagPref(session.discordId, HIDE_CLUB_TAG_ID);
  } else {
    const club = await getClub(clubId);
    if (!club || !club.members.some((m) => m.discordId === session.discordId)) {
      return NextResponse.json(
        { error: "Join that clan before using its tag." },
        { status: 400 }
      );
    }
    await setClubTagPref(session.discordId, club.id);
  }

  const clubs = await clubsForMember(session.discordId);
  const pref = await getClubTagPref(session.discordId);
  const tags = await clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} }));
  return NextResponse.json({
    ok: true,
    activeClubId: pref,
    displayedTag: lookupClubTag(tags, session.playerName, session.discordId),
    clubs: clubs.map(summarizeClub),
  });
}
