import { PartyMember } from "@/lib/parties";
import { getPlayer, mapRank } from "@/lib/db";
import { avatarUrl } from "@/lib/format";
import { isValidCountry } from "@/lib/countries";
import { UserSession } from "@/types";

/** Build a party member record from the logged-in session + DB profile. */
export async function memberFromSession(session: UserSession): Promise<PartyMember> {
  let rank = "UNRANKED";
  let elo = 0;
  let avatar = session.avatar ?? null;
  let country: string | null = null;

  if (session.playerName) {
    const player = await getPlayer(session.playerName);
    if (player) {
      rank = mapRank(player.rank);
      elo = player.elo;
      country = isValidCountry(player.country) ? player.country!.toLowerCase() : null;
      const dbAvatar = avatarUrl(player.roblox_avatar_image);
      if (dbAvatar) avatar = dbAvatar;
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
  };
}
