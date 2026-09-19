import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPlayer, getPlayerByDiscordId, getMatchesForPlayer, getPlacementMatchesForPlayer, getEloChanges, getModeRatings, getMostPlayedWith, getPlayerRankings, getPlacementGamesTotal, getSeasonResets, getSeasonFinalElos, getCareerMatchCount, getLastSeasonArchive, mapRank } from "@/lib/db";
import { buildEloTimeline } from "@/lib/elo-timeline";
import { getEquippedCosmetics, getInventory } from "@/lib/cosmetics";
import { getFriends } from "@/lib/social";
import { resolvePlayerAvatar, resolveAvatarMap } from "@/lib/avatar";
import { prettyMap, prettyRegion, formatRoundScore } from "@/lib/format";
import { countryName, flagPath, isValidCountry } from "@/lib/countries";
import { countryToPlayRegion } from "@/lib/country-regions";
import { regionMeta } from "@/lib/regions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    let player = await getPlayer(decodedName);
    if (!player) {
      // Stale session links use the Discord login name after the website
      // username was switched to the server display name.
      const session = await getSession();
      if (session) {
        const mine = await getPlayerByDiscordId(session.discordId);
        if (mine) {
          const aliases = [
            mine.name,
            mine.discord_username,
            session.playerName,
            session.username,
            session.discordUsername,
          ]
            .filter((v): v is string => !!v)
            .map((v) => v.toLowerCase());
          if (aliases.includes(decodedName.toLowerCase())) {
            player = mine;
          }
        }
      }
    }

    if (!player) {
      return NextResponse.json(
        { error: "Player not found" },
        { status: 404 }
      );
    }

    const playerName = player.name;

    // These are all independent of one another — fetch them concurrently
    // instead of one sequential await per data source.
    const [matches, placementRows, eloChanges, avatar, playedWithRaw, rankings, cosmetics, friends, inventory, placementGamesTotal, modeRatings, seasonResets, seasonFinalElos, careerMatchesPlayed, lastSeasonArchive] =
      await Promise.all([
        getMatchesForPlayer(playerName),
        getPlacementMatchesForPlayer(playerName),
        getEloChanges(playerName),
        resolvePlayerAvatar(playerName, player.roblox_avatar_image, player.discord_avatar, player.discord_id),
        getMostPlayedWith(playerName, 10),
        getPlayerRankings(playerName).catch(() => ({ overall: null, country: null, region: null })),
        getEquippedCosmetics(playerName).catch(() => ({
          card: null,
          frame: null,
          background: null,
          title: null,
          badges: [],
        })),
        getFriends(playerName).catch(() => []),
        getInventory(playerName).catch(() => []),
        getPlacementGamesTotal(),
        getModeRatings(playerName),
        getSeasonResets(),
        getSeasonFinalElos(playerName),
        getCareerMatchCount(playerName),
        getLastSeasonArchive(playerName),
      ]);

    const playedAvatars = await resolveAvatarMap(playedWithRaw);
    const playedWith = playedWithRaw.map((p) => ({
      name: p.name,
      count: p.count,
      discordUsername: p.discordUsername,
      avatar: playedAvatars.get(p.name) || null,
    }));

    const playRegion = countryToPlayRegion(player.country);
    const region = playRegion ? regionMeta(playRegion) : { label: "", short: "" };

    // Build the ELO history season by season. Reconstructing the whole curve
    // backwards from the CURRENT Elo breaks after a season reset (everyone drops
    // to 0, so past matches march negative); instead each past season is anchored
    // to the final Elo /resetdb archived for it, and the line is broken at every
    // reset boundary so the new season starts fresh.
    const { history: eloHistory, resets: eloResets } = buildEloTimeline(
      player.elo,
      eloChanges,
      seasonResets,
      seasonFinalElos
    );

    const lastResetAt = seasonResets.length
      ? seasonResets[seasonResets.length - 1].reset_at
      : null;
    const placementThisSeason = lastResetAt
      ? placementRows.filter((m) => (m.timestamp || "") >= lastResetAt)
      : placementRows;
    const seasonRanked = lastResetAt
      ? matches.filter((m) => (m.timestamp || "") >= lastResetAt)
      : matches;
    const seasonMatchesPlayed = seasonRanked.length;
    const seasonWins = seasonRanked.filter((m) => m.result === "W").length;
    const seasonWinPercent =
      seasonMatchesPlayed > 0 ? (seasonWins / seasonMatchesPlayed) * 100 : 0;

    const mapped = {
      id: `p${player.id}`,
      username: player.name,
      discordUsername: player.discord_username ?? null,
      avatarUrl: avatar,
      rank: mapRank(player.rank),
      elo: player.elo,
      peakElo: player.peak_elo,
      region: region.short || "",
      regionFlag: region.short || "🌐",
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
      /** Season boundaries in eloHistory (index of the break + season name). */
      eloResets,
      careerMatchesPlayed,
      seasonMatchesPlayed,
      seasonWinPercent,
      lastResetAt,
      lastSeason: lastSeasonArchive
        ? {
            name: lastSeasonArchive.season_name,
            elo: lastSeasonArchive.elo,
            rank: mapRank(lastSeasonArchive.rank),
          }
        : null,
      placementDone: player.placement_done === 1,
      placementGamesPlayed: player.placement_games_played,
      placementGamesTotal,
      placementMatches: placementThisSeason.map((m) => ({
        id: `M-${m.id}`,
        date: m.timestamp || "",
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
        mvps: m.mvps || 0,
      })),
      // Own-ladder gamemode ratings (e.g. the separate 1v1 ladder).
      modes: modeRatings.map((mr) => ({
        mode: mr.mode,
        elo: mr.elo,
        rank: mapRank(mr.rank),
        peakElo: mr.peak_elo,
        matchesPlayed: mr.matches_played,
        matchesWon: mr.matches_won,
        placementDone: Number(mr.placement_done) === 1,
        placementGamesPlayed: mr.placement_games_played,
      })),
      playedWith,
      rankings,
      cosmetics,
      // Public social/inventory data for the FACEIT-style profile tabs.
      friends,
      inventory,
      matchHistory: matches.map((m) => ({
        id: `M-${m.id}`,
        date: m.timestamp || "",
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
        mvps: m.mvps || 0,
        isSub: Number(m.is_sub) === 1,
        leftEarly: Number(m.left_early) === 1,
        subShare: m.sub_share == null ? null : Number(m.sub_share),
        rank: mapRank(m.player_rank || player.rank),
        elo: m.elo_before == null ? undefined : Number(m.elo_before),
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
