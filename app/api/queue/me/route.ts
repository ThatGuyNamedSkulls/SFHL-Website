import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getPlacementGamesTotal,
  getPlayerByDiscordId,
  getPlayerLastQueueRegion,
  getPlayerRankings,
  publicRating,
} from "@/lib/db";
import { pickAvatar } from "@/lib/avatar";
import { getEquippedCosmetics } from "@/lib/cosmetics";
import { countryToPlayRegion } from "@/lib/country-regions";
import { isValidCountry } from "@/lib/countries";
import { currentSeason, prestigeFromWins, seasonWins, syncPrestige } from "@/lib/prestige";

export const dynamic = "force-dynamic";

/**
 * GET — what the Play page needs about YOU, in one light call
 * (docs/QUEUE_UI_PLAN.md §6.2): rank and Elo, placement progress with the real
 * total, the season, prestige (paying any newly reached level), and the region
 * to pick for you. Replaces the page's fetch of the full profile endpoint.
 */
export async function GET() {
  const session = await getSession();
  const [season, placementTotal] = await Promise.all([currentSeason(), getPlacementGamesTotal()]);
  const seasonOut = { number: season.number, label: season.label };
  if (!session) return NextResponse.json({ player: null, season: seasonOut, placementTotal });

  const player = await getPlayerByDiscordId(session.discordId);
  if (!player) return NextResponse.json({ player: null, season: seasonOut, placementTotal });

  const rating = publicRating(player);
  const [prestige, cosmetics, lastRegion, rankings] = await Promise.all([
    syncPrestige(player.name).catch(async (error) => {
      console.error("prestige sync failed", error);
      return { ...prestigeFromWins(await seasonWins(player.name, season.startedAt).catch(() => 0)), newlyReached: [] };
    }),
    getEquippedCosmetics(player.name).catch(() => null),
    getPlayerLastQueueRegion(player.name).catch(() => null),
    rating.placementDone
      ? getPlayerRankings(player.name).catch(() => null)
      : Promise.resolve(null),
  ]);
  const country = isValidCountry(player.country) ? player.country!.toLowerCase() : null;

  return NextResponse.json(
    {
      player: {
        name: player.name,
        rank: rating.rank,
        elo: rating.elo,
        peakElo: rating.peakElo,
        placementDone: rating.placementDone,
        placementPlayed: Math.min(Number(player.placement_games_played) || 0, placementTotal),
        avatar: pickAvatar(player.roblox_avatar_image, player.discord_avatar, player.discord_id) || null,
        country,
        card: cosmetics?.card?.asset ?? null,
        frame: cosmetics?.frame?.asset ?? null,
        mmAccess: Number(player.mm_access) === 1,
        /** Overall leaderboard position (graduated players only). */
        position: rankings?.overall ?? null,
      },
      season: seasonOut,
      placementTotal,
      prestige: {
        wins: prestige.wins,
        level: prestige.level,
        maxed: prestige.maxed,
        nextAt: prestige.nextAt,
        winsIntoLevel: prestige.winsIntoLevel,
        winsPerLevel: prestige.winsPerLevel,
        maxLevel: prestige.maxLevel,
        coinsPerLevel: prestige.coinsPerLevel,
        newlyReached: prestige.newlyReached,
      },
      lastRegion,
      countryRegion: countryToPlayRegion(country),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
