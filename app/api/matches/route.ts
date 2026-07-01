import { NextResponse } from "next/server";
import { getMatchesForPlayer, getAllMatchIds } from "@/lib/db";
import { prettyMap, prettyRegion } from "@/lib/format";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const playerName = searchParams.get("player");

    if (playerName) {
      const matches = await getMatchesForPlayer(playerName);
      const mapped = matches.map((m) => ({
        id: `M-${m.id}`,
        date: m.timestamp?.split(" ")[0] || "",
        region: prettyRegion(m.region),
        map: prettyMap(m.map_name),
        mode: "Competitive",
        result: m.result,
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        kdr: m.deaths > 0 ? +(m.kills / m.deaths).toFixed(2) : m.kills,
        headshotPercent: m.hs_percentage,
        eloChange: m.elo_change,
        score: m.points,
        rounds: "",
        mvp: (m.mvps || 0) > 0,
        matchId: m.match_id,
      }));
      return NextResponse.json(mapped);
    }

    // Return all distinct matches (most recent first), with clean labels.
    const allMatches = await getAllMatchIds();
    const matchIds = allMatches.map((m) => ({
      matchId: m.match_id,
      date: m.timestamp?.split(" ")[0] || "",
      map: prettyMap(m.map_name),
      region: prettyRegion(m.region),
    }));
    return NextResponse.json(matchIds);
    
  } catch (error) {
    console.error("Error fetching matches:", error);
    return NextResponse.json(
      { error: "Failed to fetch matches" },
      { status: 500 }
    );
  }
}
