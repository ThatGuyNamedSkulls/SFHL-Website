import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMatchesForPlayer } from "@/lib/db";
import { formatRoundScore, prettyMap } from "@/lib/format";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { performanceRating, roundCount, swingPercent } from "@/lib/match-stats";

export const dynamic = "force-dynamic";

/** Last 8 ranked matches for the logged-in player (VS Matches drawer). */
export async function GET() {
  const session = await getSession();
  if (!session?.playerName) return NextResponse.json({ matches: [] });

  try {
    const rows = await getMatchesForPlayer(session.playerName, 8);
    const matches = rows.map((m) => {
      const rounds = roundCount(m.round_score);
      const rating = performanceRating({
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        rounds,
        score: m.points,
        mvps: m.mvps || 0,
      });
      return {
        id: m.id,
        matchId: m.match_id,
        date: m.timestamp || "",
        map: prettyMap(m.map_name),
        result: m.result === "W" ? "W" : "L",
        rounds: formatRoundScore(m.round_score, m.result),
        mode: MATCH_MODE_LABEL,
        swing: swingPercent(rating),
        isSub: Number(m.is_sub) === 1,
        leftEarly: Number(m.left_early) === 1,
        subShare: m.sub_share == null ? null : Number(m.sub_share),
      };
    });
    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error fetching recent matches:", error);
    return NextResponse.json({ matches: [] });
  }
}
