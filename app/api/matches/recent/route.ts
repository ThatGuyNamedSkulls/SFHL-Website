import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMatchesForPlayer } from "@/lib/db";
import { formatRoundScore, prettyMap } from "@/lib/format";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";

export const dynamic = "force-dynamic";

/** Last 8 ranked matches for the logged-in player (VS Matches drawer). */
export async function GET() {
  const session = await getSession();
  if (!session?.playerName) return NextResponse.json({ matches: [] });

  try {
    const rows = await getMatchesForPlayer(session.playerName, 8);
    const matches = rows.map((m) => ({
      id: m.id,
      matchId: m.match_id,
      date: m.timestamp || "",
      map: prettyMap(m.map_name),
      result: m.result === "W" ? "W" : "L",
      rounds: formatRoundScore(m.round_score, m.result),
      mode: MATCH_MODE_LABEL,
    }));
    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error fetching recent matches:", error);
    return NextResponse.json({ matches: [] });
  }
}
