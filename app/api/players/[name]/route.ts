import { NextResponse } from "next/server";
import { getPlayer, getMatchesForPlayer, getMostPlayedWith, mapRank } from "@/lib/db";
import { avatarUrl, prettyMap, prettyRegion, regionMeta } from "@/lib/format";
import { countryName, flagPath, isValidCountry } from "@/lib/countries";

/**
 * Turn the match-level `round_score` ("winnerRounds,loserRounds", e.g. "13,11")
 * into a scoreline from this player's perspective ("13:11" on a win, "11:13"
 * on a loss). Returns "" when no round score is stored.
 */
function formatRoundScore(raw: string | null, result: string): string {
  if (!raw) return "";
  const nums = raw
    .split(/[,:]/)
    .map((p) => Number(p.trim()))
    .filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return "";
  // The winner always holds the higher round count, so derive the player's
  // perspective from the result rather than trusting the stored order.
  const hi = Math.max(nums[0], nums[1]);
  const lo = Math.min(nums[0], nums[1]);
  return result === "W" ? `${hi}:${lo}` : `${lo}:${hi}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const player = getPlayer(decodedName);

    if (!player) {
      return NextResponse.json(
        { error: "Player not found" },
        { status: 404 }
      );
    }

    // Get match history for ELO trend
    const matches = getMatchesForPlayer(decodedName);

    // Dominant server region for this player (most-played region across matches).
    const regionCounts: Record<string, number> = {};
    for (const m of matches) {
      if (m.region) regionCounts[m.region] = (regionCounts[m.region] ?? 0) + 1;
    }
    const dominantRegion = Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const region = regionMeta(dominantRegion);

    // Build ELO history from match elo_changes (reconstruct backwards)
    const eloHistory: number[] = [];
    let currentElo = player.elo;
    eloHistory.unshift(currentElo);
    for (const match of matches) {
      currentElo -= match.elo_change;
      eloHistory.unshift(currentElo);
    }

    const mapped = {
      id: `p${player.id}`,
      username: player.name,
      avatarUrl: avatarUrl(player.roblox_avatar_image),
      rank: mapRank(player.rank),
      elo: player.elo,
      peakElo: player.peak_elo,
      region: region.label,
      regionFlag: region.flag,
      country: isValidCountry(player.country) ? player.country!.toLowerCase() : null,
      countryName: isValidCountry(player.country) ? countryName(player.country) : null,
      countryFlag: isValidCountry(player.country) ? flagPath(player.country) : null,
      stats: {
        wins: player.matches_won,
        losses: player.matches_played - player.matches_won,
        matchesPlayed: player.matches_played,
        kills: player.total_kills,
        deaths: player.total_deaths,
        assists: player.total_assists,
        headshotPercent: player.avg_hs_percent,
        kd: player.kd_ratio,
        winPercent:
          player.matches_played > 0
            ? (player.matches_won / player.matches_played) * 100
            : 0,
        scorePerGame:
          player.matches_played > 0
            ? Math.round(player.total_score / player.matches_played)
            : 0,
        avgMvp:
          player.matches_played > 0
            ? player.total_mvps / player.matches_played
            : 0,
        playtimeHours: Math.round(player.total_play_time / 3600),
      },
      eloHistory,
      placementDone: player.placement_done === 1,
      placementGamesPlayed: player.placement_games_played,
      playedWith: getMostPlayedWith(decodedName, 10),
      matchHistory: matches.map((m) => ({
        id: `M-${m.id}`,
        date: m.timestamp?.split(" ")[0] || "",
        region: prettyRegion(m.region),
        map: prettyMap(m.map_name),
        mode: "Competitive" as const,
        result: m.result as "W" | "L",
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        kdr: m.deaths > 0 ? +(m.kills / m.deaths).toFixed(2) : m.kills,
        headshotPercent: m.hs_percentage,
        eloChange: m.elo_change,
        score: m.points,
        rounds: formatRoundScore(m.round_score, m.result),
        mvp: (m.mvps || 0) > 0,
        matchId: m.match_id,
      })),
    };

    return NextResponse.json(mapped);
  } catch (error) {
    console.error("Error fetching player:", error);
    return NextResponse.json(
      { error: "Failed to fetch player" },
      { status: 500 }
    );
  }
}
