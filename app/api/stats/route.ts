import { NextResponse } from "next/server";
import { getAggregateStats } from "@/lib/db";
import { remember } from "@/lib/server-cache";

export async function GET() {
  try {
    const stats = await remember("aggregate-stats", 15000, getAggregateStats);

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
