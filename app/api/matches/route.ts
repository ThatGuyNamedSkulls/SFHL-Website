import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMatchesForPlayer } from "@/lib/db";
import { prettyMap, prettyRegion } from "@/lib/format";
import { recentMatches } from "@/lib/match-list";

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

    // Site-wide list (/matches, dashboard, landing): newest first, in pages.
    // ?limit=1..100 (default 50) &offset=; the viewer's own line comes along.
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
    const session = await getSession().catch(() => null);
    const page = await recentMatches({ limit, offset, viewer: session?.playerName ?? null });
    return NextResponse.json(page);
  } catch (error) {
    console.error("Error fetching matches:", error);
    return NextResponse.json(
      { error: "Failed to fetch matches" },
      { status: 500 }
    );
  }
}
