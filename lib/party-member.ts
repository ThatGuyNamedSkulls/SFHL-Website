import { Party, PartyMember } from "@/lib/parties";
import { getPlayer, getPlayerByDiscordId, mapRank } from "@/lib/db";
import { upsertWebUser } from "@/lib/social";
import { getEquippedCosmetics, getEquippedVisualsMap, EquippedVisuals } from "@/lib/cosmetics";
import { getGuildPresenceCached } from "@/lib/auth";
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
  let discordUsername: string | null = session.discordUsername ?? null;

  const player =
    (await getPlayerByDiscordId(session.discordId)) ||
    (session.playerName ? await getPlayer(session.playerName) : undefined);
  const playerName = player?.name ?? session.playerName;

  // Remember this player's Discord id so the bot can DM them by id.
  upsertWebUser(session.discordId, playerName, playerName || session.username).catch(() => {});

  if (player) {
    rank = mapRank(player.rank);
    elo = player.elo;
    country = isValidCountry(player.country) ? player.country!.toLowerCase() : null;
    discordUsername = player.discord_username ?? discordUsername;
    const dbAvatar = await resolvePlayerAvatar(
      player.name,
      player.roblox_avatar_image,
      player.discord_avatar,
      player.discord_id
    );
    if (dbAvatar) avatar = dbAvatar;
    try {
      const cosmetics = await getEquippedCosmetics(player.name);
      card = cosmetics.card?.asset ?? null;
      frame = cosmetics.frame?.asset ?? null;
    } catch {
      /* cosmetics schema not ready — no card/frame */
    }
  }

  return {
    discordId: session.discordId,
    username: playerName || session.username,
    playerName,
    discordUsername,
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

/**
 * Attach live queue-eligibility to every member: `verified` (Bloxlink role on
 * the HyperLeague Discord; null when it can't be determined) and `canQueue`
 * (in the guild, Bloxlink-verified, and linked to a player).
 */
export async function withMemberStatus<T extends Party>(parties: T[]): Promise<T[]> {
  const ids = Array.from(new Set(parties.flatMap((p) => p.members.map((m) => m.discordId))));
  const status = new Map<string, { inGuild: boolean; verified: boolean; mmAccess: boolean } | null>();
  await Promise.all(ids.map(async (id) => status.set(id, await getGuildPresenceCached(id))));
  let tags: { byName: Record<string, string>; byDiscord: Record<string, string> } = {
    byName: {},
    byDiscord: {},
  };
  try {
    const { clubTagIndex } = await import("@/lib/clubs");
    tags = await clubTagIndex();
  } catch {
    /* clubs table may be empty */
  }
  return parties.map((p) => ({
    ...p,
    members: p.members.map((m) => {
      const presence = status.get(m.discordId) ?? null;
      const verified = presence === null ? null : presence.inGuild && presence.verified;
      const mmAccess = presence === null ? null : presence.mmAccess;
      const canQueue =
        (presence === null || (presence.inGuild && presence.verified)) && !!m.playerName;
      const clubTag =
        (m.discordId && tags.byDiscord[m.discordId]) ||
        (m.playerName ? tags.byName[m.playerName.toLowerCase()] : null) ||
        null;
      return { ...m, verified, mmAccess, canQueue, clubTag };
    }),
  }));
}
