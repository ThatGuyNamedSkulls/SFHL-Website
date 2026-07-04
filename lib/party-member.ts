import { Party, PartyMember } from "@/lib/parties";
import { getPlayer, mapRank } from "@/lib/db";
import { upsertWebUser } from "@/lib/social";
import { getEquippedCosmetics, getEquippedVisualsMap, EquippedVisuals } from "@/lib/cosmetics";
import { resolvePlayerAvatar } from "@/lib/avatar";
import { isValidCountry } from "@/lib/countries";
import { UserSession } from "@/types";

/** Build a party member record from the logged-in session + DB profile. */
export async function memberFromSession(session: UserSession): Promise<PartyMember> {
  let rank = "UNRANKED";
  let elo = 0;
  let avatar = session.avatar ?? null;
  let country: string | null = null;
  let card: string | null = null;
  let frame: string | null = null;

  // Remember this player's Discord id so the bot can DM them by id.
  upsertWebUser(session.discordId, session.playerName, session.username).catch(() => {});

  if (session.playerName) {
    const player = await getPlayer(session.playerName);
    if (player) {
      rank = mapRank(player.rank);
      elo = player.elo;
      country = isValidCountry(player.country) ? player.country!.toLowerCase() : null;
      const dbAvatar = await resolvePlayerAvatar(session.playerName, player.roblox_avatar_image);
      if (dbAvatar) avatar = dbAvatar;
    }
    try {
      const cosmetics = await getEquippedCosmetics(session.playerName);
      card = cosmetics.card?.asset ?? null;
      frame = cosmetics.frame?.asset ?? null;
    } catch {
      /* cosmetics schema not ready — no card/frame */
    }
  }

  return {
    discordId: session.discordId,
    username: session.username,
    playerName: session.playerName,
    avatar,
    rank,
    elo,
    country,
    card,
    frame,
  };
}

/**
 * Replace each member's stored card/frame snapshot with their *currently*
 * equipped ones (single query for all members). Without this, a cosmetic
 * change after joining would never show up in the party finder or queue
 * lobby, because parties store members as JSON snapshots.
 */
export async function withFreshCosmetics<T extends Party>(parties: T[]): Promise<T[]> {
  let visuals: Map<string, EquippedVisuals>;
  try {
    visuals = await getEquippedVisualsMap();
  } catch {
    return parties; // cosmetics schema not ready — keep the snapshots
  }
  return parties.map((p) => ({
    ...p,
    members: p.members.map((m) => {
      const v = m.playerName ? visuals.get(m.playerName) : undefined;
      return { ...m, card: v?.card ?? null, frame: v?.frame ?? null };
    }),
  }));
}
