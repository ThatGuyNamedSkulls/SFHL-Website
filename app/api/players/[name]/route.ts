import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getPlayer,
  getPlayerByDiscordId,
  getMatchesForPlayer,
  getPlacementMatchesForPlayer,
  getEloChanges,
  getModeRatings,
  getMostPlayedWith,
  getPlayerRankings,
  getPlacementGamesTotal,
  getSeasonResets,
  getSeasonFinalElos,
  getCareerMatchCount,
  getLastSeasonArchive,
  getCbStats,
  getProfileSummary,
  getMatchTimestamps,
  toDbTimestamp,
  mapRank,
  publicRating,
} from "@/lib/db";
import { buildEloTimeline } from "@/lib/elo-timeline";
import { damagePerRound } from "@/lib/match-stats";
import { badgeIndex, nameBadgeFor } from "@/lib/name-badge";
import { getEquippedCosmetics, getInventory } from "@/lib/cosmetics";
import { getFriends } from "@/lib/social";
import { pickAvatar, resolveAvatarMap } from "@/lib/avatar";
import { countryName, flagPath, isValidCountry } from "@/lib/countries";
import { countryToPlayRegion } from "@/lib/country-regions";
import { regionMeta } from "@/lib/regions";
import { clubTagIndex, lookupClubTag } from "@/lib/clubs";
import { prestigeFromWins } from "@/lib/prestige";
import { getBio } from "@/lib/player-bios";
import { summarizeTeam, teamsForMember } from "@/lib/teams";
import { titleCounts } from "@/lib/team-titles";
import { toProfileMatch } from "@/lib/profile-match";
import { shownBans } from "@/lib/bans";

/** Matches sent with the profile; older ones come from ./matches ("Load more"). */
const MATCH_PAGE = 100;
/** The activity heatmap covers 13 weeks; a few extra days fill its first column. */
const ACTIVITY_DAYS = 98;

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
    const discordId = player.discord_id != null ? String(player.discord_id) : null;
    // Stored flag only: the bot syncs it hourly and every login refreshes it.
    // A public GET must not call Discord or write (security report M1).
    const mmAccess = Number(player.mm_access) === 1;
    const badge = nameBadgeFor(await badgeIndex(), { discordId, playerName: player.name });
    const activitySince = toDbTimestamp(new Date(Date.now() - ACTIVITY_DAYS * 86_400_000));

    // These are all independent of one another — fetch them concurrently
    // instead of one sequential await per data source.
    const [
      matches,
      placementRows,
      eloChanges,
      avatar,
      playedWithRaw,
      rankings,
      cosmetics,
      friends,
      inventory,
      placementGamesTotal,
      modeRatings,
      seasonResets,
      seasonFinalElos,
      careerMatchesPlayed,
      lastSeasonArchive,
      activity,
      bio,
      teams,
      bans,
    ] = await Promise.all([
      getMatchesForPlayer(playerName, MATCH_PAGE),
      getPlacementMatchesForPlayer(playerName),
      getEloChanges(playerName),
      pickAvatar(player.roblox_avatar_image, player.discord_avatar, player.discord_id),
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
      getMatchTimestamps(playerName, activitySince),
      getBio(Number(player.id)),
      discordId ? teamsForMember(discordId).catch(() => []) : Promise.resolve([]),
      shownBans(),
    ]);

    const lastResetAt = seasonResets.length
      ? seasonResets[seasonResets.length - 1].reset_at
      : null;
    const [playedAvatars, summary, cb, clubTags, teamTitles] = await Promise.all([
      resolveAvatarMap(playedWithRaw),
      getProfileSummary(playerName, lastResetAt),
      getCbStats(playerName, lastResetAt),
      clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} })),
      teams.length
        ? titleCounts(teams.map((t) => t.id)).catch(() => new Map<string, number>())
        : Promise.resolve(new Map<string, number>()),
    ]);
    const playedWith = playedWithRaw.map((p) => ({
      name: p.name,
      count: p.count,
      wins: p.wins,
      rank: p.rank,
      country: isValidCountry(p.country) ? p.country : null,
      discordUsername: p.discordUsername,
      avatar: playedAvatars.get(p.name) || null,
    }));

    const playRegion = countryToPlayRegion(player.country);
    const region = playRegion ? regionMeta(playRegion) : { label: "", short: "" };
    const rating = publicRating(player);

    // Build the ELO history season by season. Reconstructing the whole curve
    // backwards from the CURRENT Elo breaks after a season reset (everyone drops
    // to 0, so past matches march negative); instead each past season is anchored
    // to the final Elo /resetdb archived for it, and the line is broken at every
    // reset boundary so the new season starts fresh.
    const { history: eloHistory, times: eloTimes, resets: eloResets } = buildEloTimeline(
      rating.elo,
      eloChanges,
      seasonResets,
      seasonFinalElos
    );

    const placementThisSeason = lastResetAt
      ? placementRows.filter((m) => (m.timestamp || "") >= lastResetAt)
      : placementRows;
    const cbStats = cb && {
      matches: cb.matches,
      roundsPlayed: cb.roundsPlayed,
      adr: damagePerRound(cb.damage, cb.roundsPlayed),
      firstKills: cb.firstKills,
      rounds2k: cb.rounds2k,
      rounds3k: cb.rounds3k,
      rounds4k: cb.rounds4k,
      rounds5k: cb.rounds5k,
    };
    const seasonNumber = seasonResets.length + 1;

    const mapped = {
      id: `p${player.id}`,
      username: player.name,
      discordUsername: player.discord_username ?? null,
      avatarUrl: avatar,
      rank: rating.rank,
      elo: rating.elo,
      peakElo: rating.peakElo,
      region: region.short || "",
      regionFlag: region.short || "🌐",
      country: isValidCountry(player.country) ? player.country!.toLowerCase() : null,
      countryName: isValidCountry(player.country) ? countryName(player.country) : null,
      countryFlag: isValidCountry(player.country) ? flagPath(player.country) : null,
      mmAccess,
      badge,
      clubTag: lookupClubTag(clubTags, player.name, discordId),
      /** An active /player ban: shown as "Banned" (the reason is staff-only). */
      ban: discordId && bans.has(discordId) ? { since: bans.get(discordId) ?? null } : null,
      bio,
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
      /** Timestamp of the match behind each eloHistory point (null for starts and breaks). */
      eloTimes,
      /** Season boundaries in eloHistory (index of the break + season name). */
      eloResets,
      careerMatchesPlayed,
      cbStats,
      season: { number: seasonNumber, label: `Season ${seasonNumber}`, startedAt: lastResetAt },
      /** This season's ranked record, counted in the database (not from the 100 rows below). */
      seasonMatchesPlayed: summary.seasonMatches,
      seasonWins: summary.seasonWins,
      seasonWinPercent:
        summary.seasonMatches > 0 ? (summary.seasonWins / summary.seasonMatches) * 100 : 0,
      prestige: prestigeFromWins(summary.seasonWins),
      firstMatchAt: summary.firstMatchAt,
      lastMatchAt: summary.lastMatchAt,
      /** Match times (UTC) of the last ACTIVITY_DAYS days, for the heatmap. */
      activity,
      lastResetAt,
      lastSeason: lastSeasonArchive
        ? {
            name: lastSeasonArchive.season_name,
            elo: lastSeasonArchive.elo,
            rank: mapRank(lastSeasonArchive.rank),
          }
        : null,
      placementDone: rating.placementDone,
      placementGamesPlayed: player.placement_games_played,
      placementGamesTotal,
      placementMatches: placementThisSeason.map((m) => toProfileMatch(m, player.rank)),
      // Own-ladder gamemode ratings (e.g. the separate 1v1 ladder).
      modes: modeRatings.map((mr) => {
        const modeRating = publicRating(mr);
        return {
          mode: mr.mode,
          elo: modeRating.elo,
          rank: modeRating.rank,
          peakElo: modeRating.peakElo,
          matchesPlayed: mr.matches_played,
          matchesWon: mr.matches_won,
          placementDone: modeRating.placementDone,
          placementGamesPlayed: mr.placement_games_played,
        };
      }),
      playedWith,
      rankings,
      cosmetics,
      teams: teams.map((team) => {
        const me = team.members.find((m) => m.discordId === discordId);
        return {
          ...summarizeTeam(team),
          role: team.captainId === discordId ? "captain" : me?.role ?? "starter",
          titles: teamTitles.get(team.id) ?? 0,
          roster: team.members
            .filter((m) => m.status === "accepted")
            .slice(0, 8)
            .map((m) => ({ name: m.playerName || m.username, avatar: m.avatar })),
        };
      }),
      // Public social/inventory data for the FACEIT-style profile tabs.
      friends,
      inventory,
      matchHistory: matches.map((m) => toProfileMatch(m, player.rank)),
      /** True when older matches exist beyond matchHistory. */
      hasMoreMatches: matches.length === MATCH_PAGE,
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
