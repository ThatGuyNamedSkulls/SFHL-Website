import { NextResponse } from "next/server";
import { getAllPlayers, getModeLeaderboard, getPlayerRegions, getPlacementGamesTotal, mapRank } from "@/lib/db";
import { getEquippedVisualsMap, EquippedVisuals } from "@/lib/cosmetics";
import { regionMeta } from "@/lib/format";
import { pickAvatar } from "@/lib/avatar";
import { countryName, flagPath, isValidCountry } from "@/lib/countries";

export async function GET(request: Request) {
  try {
    // ?mode=1v1 → the own-ladder leaderboard for that gamemode (graduated
    // players only), in the same shape the main leaderboard consumers use.
    const modeParam = new URL(request.url).searchParams.get("mode");
    if (modeParam && modeParam !== "5v5") {
      const [rows, cards] = await Promise.all([
        getModeLeaderboard(modeParam),
        getEquippedVisualsMap().catch(() => new Map<string, EquippedVisuals>()),
      ]);
      const mappedModes = rows.map((r, idx) => {
        const hasCountry = isValidCountry(r.country);
        return {
          id: `m${modeParam}-${idx}`,
          username: r.player_name,
          discordUsername: r.discord_username ?? null,
          avatarUrl: pickAvatar(r.roblox_avatar_image, r.discord_avatar),
          cardAsset: cards.get(r.player_name)?.card ?? null,
          frameAsset: cards.get(r.player_name)?.frame ?? null,
          rank: mapRank(r.rank),
          elo: r.elo,
          peakElo: r.peak_elo,
          region: "—",
          regionFlag: "🌐",
          country: hasCountry ? r.country!.toLowerCase() : null,
          countryName: hasCountry ? countryName(r.country) : null,
          countryFlag: hasCountry ? flagPath(r.country) : null,
          position: idx + 1,
          stats: {
            wins: r.matches_won,
            losses: r.matches_played - r.matches_won,
            matchesPlayed: r.matches_played,
            kills: 0, deaths: 0, assists: 0, headshotPercent: 0, kd: 0,
            winPercent:
              r.matches_played > 0 ? (r.matches_won / r.matches_played) * 100 : 0,
            scorePerGame: 0,
            avgMvp: 0,
            playtimeHours: 0,
          },
          placementDone: Number(r.placement_done) === 1,
          placementGamesPlayed: r.placement_games_played,
        };
      });
      return NextResponse.json(mappedModes);
    }

    const [players, regions, cards, placementGamesTotal] = await Promise.all([
      getAllPlayers(),
      getPlayerRegions(),
      getEquippedVisualsMap().catch(() => new Map<string, EquippedVisuals>()),
      getPlacementGamesTotal(),
    ]);

    const mapped = players.map((p, idx) => {
      const region = regionMeta(regions[p.name]);
      const hasCountry = isValidCountry(p.country);
      return {
      id: `p${p.id}`,
      username: p.name,
      discordUsername: p.discord_username ?? null,
      avatarUrl: pickAvatar(p.roblox_avatar_image, p.discord_avatar),
      cardAsset: cards.get(p.name)?.card ?? null,
      frameAsset: cards.get(p.name)?.frame ?? null,
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
      placementGamesTotal,
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
