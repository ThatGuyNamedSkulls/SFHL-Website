import { NextResponse } from "next/server";
import { getAllPlayers, getPlayerRegions, mapRank } from "@/lib/db";
import { avatarUrl, regionMeta } from "@/lib/format";
import { countryName, flagPath, isValidCountry } from "@/lib/countries";

export async function GET() {
  try {
    const players = await getAllPlayers();
    const regions = await getPlayerRegions();

    const mapped = players.map((p, idx) => {
      const region = regionMeta(regions[p.name]);
      const hasCountry = isValidCountry(p.country);
      return {
      id: `p${p.id}`,
      username: p.name,
      avatarUrl: avatarUrl(p.roblox_avatar_image),
      rank: mapRank(p.rank),
      elo: p.elo,
      peakElo: p.peak_elo,
      region: region.label,
      regionFlag: region.flag,
      country: hasCountry ? p.country!.toLowerCase() : null,
      countryName: hasCountry ? countryName(p.country) : null,
      countryFlag: hasCountry ? flagPath(p.country) : null,
      position: idx + 1,
      stats: {
        wins: p.matches_won,
        losses: p.matches_played - p.matches_won,
        matchesPlayed: p.matches_played,
        kills: p.total_kills,
        deaths: p.total_deaths,
        assists: p.total_assists,
        headshotPercent: p.avg_hs_percent,
        kd: p.kd_ratio,
        winPercent:
          p.matches_played > 0
            ? (p.matches_won / p.matches_played) * 100
            : 0,
        scorePerGame:
          p.matches_played > 0
            ? Math.round(p.total_score / p.matches_played)
            : 0,
        avgMvp:
          p.matches_played > 0
            ? p.total_mvps / p.matches_played
            : 0,
        playtimeHours: Math.round(p.total_play_time / 3600),
      },
      placementDone: p.placement_done === 1,
      placementGamesPlayed: p.placement_games_played,
      };
    });

    return NextResponse.json(mapped);
  } catch (error) {
    console.error("Error fetching players:", error);
    return NextResponse.json(
      { error: "Failed to fetch players" },
      { status: 500 }
    );
  }
}
