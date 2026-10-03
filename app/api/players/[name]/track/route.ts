import { NextResponse } from "next/server";
import {
  getPlacementGamesTotal,
  getPlacementMatchesForPlayer,
  getPlayer,
  getProfileSummary,
  getSeasonResets,
  publicRating,
} from "@/lib/db";
import { pickAvatar } from "@/lib/avatar";
import { prestigeFromWins } from "@/lib/prestige";
import { toProfileMatch } from "@/lib/profile-match";
import {
  getPeakTime,
  getPlayerMatches,
  getTierBenchmark,
  getTrackOptions,
  trackWindows,
} from "@/lib/track";
import { DEFAULT_TRACK_RANGE, isTrackRange, type TrackRange } from "@/lib/track-link";

/** Newest ranked matches sent unfiltered for the Today card and the last session. */
const RECENT_ROWS = 50;

/**
 * GET ?range=last20|last50|7d|30d|season|career&map=&mode= — the Track page
 * (docs/TRACK_UI_PLAN.md): the range's ranked matches and the period before,
 * the newest matches for "Today", the filter options, and this season's
 * averages for the player's skill tier. Anyone's tracker is public (Q1).
 * `map` is one of `options.maps[].value` (a map's stored spellings, "|"-joined).
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const player = await getPlayer(decodeURIComponent(name));
    if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });

    const url = new URL(request.url);
    const rawRange = url.searchParams.get("range");
    const range: TrackRange = isTrackRange(rawRange) ? rawRange : DEFAULT_TRACK_RANGE;
    const [resetRows, options] = await Promise.all([getSeasonResets(), getTrackOptions(player.name)]);
    const resets = resetRows.map((r) => r.reset_at);
    const seasonStart = resets.length ? resets[resets.length - 1] : null;

    // Only filter values the player actually has, so the URL can't inject anything odd.
    const wantedMap = url.searchParams.get("map") ?? "";
    const mapOption = options.maps.find((m) => m.value === wantedMap) ?? null;
    const maps = mapOption ? mapOption.value.split("|") : null;
    const wantedMode = url.searchParams.get("mode") ?? "";
    const mode = options.modes.includes(wantedMode) ? wantedMode : null;

    const rating = publicRating(player);
    const [windows, recent, summary, placementRows, placementGamesTotal, benchmark, peakAt] = await Promise.all([
      trackWindows(player.name, range, { maps, mode }, resets),
      getPlayerMatches(player.name, { limit: RECENT_ROWS }),
      getProfileSummary(player.name, seasonStart),
      rating.placementDone ? Promise.resolve([]) : getPlacementMatchesForPlayer(player.name),
      getPlacementGamesTotal(),
      rating.placementDone && rating.rank !== "UNRANKED"
        ? getTierBenchmark(player.rank, seasonStart, maps)
        : Promise.resolve(null),
      rating.placementDone ? getPeakTime(player.name, rating.peakElo, seasonStart) : Promise.resolve(null),
    ]);

    const toMatch = (rows: Parameters<typeof toProfileMatch>[0][]) => rows.map((m) => toProfileMatch(m, player.rank));
    const seasonNumber = resets.length + 1;

    return NextResponse.json({
      player: {
        name: player.name,
        discordUsername: player.discord_username ?? null,
        avatarUrl: pickAvatar(player.roblox_avatar_image, player.discord_avatar, player.discord_id),
        rank: rating.rank,
        elo: rating.elo,
        peakElo: rating.peakElo,
        peakAt,
        placementDone: rating.placementDone,
        placementGamesPlayed: Number(player.placement_games_played) || 0,
        placementGamesTotal,
        prestige: prestigeFromWins(summary.seasonWins),
        season: { number: seasonNumber, label: `Season ${seasonNumber}`, startedAt: seasonStart },
      },
      range,
      filters: { map: mapOption?.value ?? null, mode },
      options,
      /** "the 20 matches before", "last season", … — null for career. */
      compare: windows.compare,
      matches: toMatch(windows.current),
      previous: windows.previous ? toMatch(windows.previous) : null,
      /** The range hit the row cap: the grid covers its newest matches only. */
      truncated: windows.truncated,
      recent: toMatch(recent),
      /** This season's placement games, for a player who hasn't finished them. */
      placementMatches: seasonStart
        ? toMatch(placementRows.filter((m) => (m.timestamp || "") >= seasonStart))
        : toMatch(placementRows),
      benchmark,
    });
  } catch (error) {
    console.error("player track GET", error);
    return NextResponse.json({ error: "Failed to fetch the tracker" }, { status: 500 });
  }
}
