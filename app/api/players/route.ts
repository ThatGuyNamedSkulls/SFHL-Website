import { NextResponse } from "next/server";
import { getAllPlayers, getModeLeaderboard, getPlacementGamesTotal, publicRating } from "@/lib/db";
import { getEquippedVisualsMap, EquippedVisuals } from "@/lib/cosmetics";
import { pickAvatar } from "@/lib/avatar";
import { countryName, flagPath, isValidCountry } from "@/lib/countries";
import { countryToPlayRegion } from "@/lib/country-regions";
import { regionMeta } from "@/lib/regions";
import { remember } from "@/lib/server-cache";
import { clubTagIndex, lookupClubTag } from "@/lib/clubs";
import { proLeagueInfo, type ProLeagueView } from "@/lib/pro-ladder";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cacheKey = searchParams.toString() || "all";

    // ?mode=1v1 → the own-ladder leaderboard for that gamemode (graduated
    // players only), in the same shape the main leaderboard consumers use.
    const modeParam = searchParams.get("mode");
    if (modeParam && modeParam !== "5v5") {
      const mappedModes = await remember(`players:mode:${modeParam}`, 8000, async () => {
        const [rows, cards, tags, league] = await Promise.all([
          getModeLeaderboard(modeParam),
          getEquippedVisualsMap().catch(() => new Map<string, EquippedVisuals>()),
          clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} })),
          // The Pro ladder is earned in league matches: where and how many (league v2 C6).
          modeParam === "pro"
            ? proLeagueInfo().catch(() => new Map<string, ProLeagueView>())
            : Promise.resolve(new Map<string, ProLeagueView>()),
        ]);
        return rows.map((r, idx) => {
          const hasCountry = isValidCountry(r.country);
          const playRegion = countryToPlayRegion(r.country);
          const rating = publicRating(r);
          return {
            id: `m${modeParam}-${idx}`,
            username: r.player_name,
            discordUsername: r.discord_username ?? null,
            avatarUrl: pickAvatar(r.roblox_avatar_image, r.discord_avatar, r.discord_id),
            cardAsset: cards.get(r.player_name)?.card ?? null,
            frameAsset: cards.get(r.player_name)?.frame ?? null,
            rank: rating.rank,
            elo: rating.elo,
            peakElo: rating.peakElo,
            region: playRegion ?? "",
            regionFlag: playRegion ?? "🌐",
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
            clubTag: lookupClubTag(tags, r.player_name, r.discord_id != null ? String(r.discord_id) : null),
            placementDone: rating.placementDone,
            placementGamesPlayed: r.placement_games_played,
            league: league.get(String(r.player_name).toLowerCase()) ?? null,
          };
        });
      });
      return NextResponse.json(mappedModes);
    }

    const limitRaw = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;

    const mapped = await remember(`players:${cacheKey}`, 8000, async () => {
      const [players, cards, placementGamesTotal, tags] = await Promise.all([
        getAllPlayers(limit),
        getEquippedVisualsMap().catch(() => new Map<string, EquippedVisuals>()),
        getPlacementGamesTotal(),
        clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} })),
      ]);

      return players.map((p, idx) => {
        const playRegion = countryToPlayRegion(p.country);
        const hasCountry = isValidCountry(p.country);
        const rating = publicRating(p);
        return {
        id: `p${p.id}`,
        username: p.name,
        discordUsername: p.discord_username ?? null,
        avatarUrl: pickAvatar(p.roblox_avatar_image, p.discord_avatar, p.discord_id),
        cardAsset: cards.get(p.name)?.card ?? null,
        frameAsset: cards.get(p.name)?.frame ?? null,
        rank: rating.rank,
        elo: rating.elo,
        peakElo: rating.peakElo,
        region: playRegion ?? "",
        regionFlag: playRegion ? regionMeta(playRegion).short : "🌐",
        country: hasCountry ? p.country!.toLowerCase() : null,
        countryName: hasCountry ? countryName(p.country) : null,
        countryFlag: hasCountry ? flagPath(p.country) : null,
        position: idx + 1,
        clubTag: lookupClubTag(tags, p.name, p.discord_id != null ? String(p.discord_id) : null),
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
        placementDone: rating.placementDone,
        placementGamesPlayed: p.placement_games_played,
        placementGamesTotal,
        };
      });
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
