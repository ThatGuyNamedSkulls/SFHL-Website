import { NextResponse } from "next/server";
import { getAggregateStats } from "@/lib/db";

export async function GET() {
  try {
    const stats = await getAggregateStats();

    return NextResponse.json({
      activePlayers: stats.totalPlayers,
      totalMatches: stats.totalMatches,
      totalKills: stats.totalKills,
      totalMatchRows: stats.totalMatchRows,
      maps: stats.maps,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
