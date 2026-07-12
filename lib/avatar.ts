/**
 * Server-side avatar resolution.
 *
 * Prefer the bot's stored Roblox avatar when it can actually be served: remote
 * URLs always can, local `/api/avatar/<file>` ones only when the file exists on
 * this instance's disk (the bot's avatars folder doesn't deploy to Vercel, so
 * there those URLs would 404 and the UI would degrade to initials). When the
 * stored avatar is missing or dead, fall back to the player's Discord profile
 * picture via their linked Discord id.
 */

import { existsSync } from "fs";
import path from "path";
import { avatarUrl } from "@/lib/format";
import { getDiscordIdForPlayer } from "@/lib/social";
import { getDiscordAvatarById } from "@/lib/auth";

/** Does the local file behind a `/api/avatar/<file>` URL exist here? */
function localAvatarExists(url: string): boolean {
  const file = decodeURIComponent(url.replace(/^\/api\/avatar\//, ""));
  const dir =
    process.env.AVATARS_PATH || path.resolve(process.cwd(), "..", "..", "avatars");
  try {
    return existsSync(path.join(dir, file));
  } catch {
    return false;
  }
}

/**
 * The best avatar URL we can serve for this player, or "" for none.
 *
 * `discordAvatar` is the URL the bot's hourly guild sync stores on the players
 * row. Prefer it over a live Discord API lookup: it costs nothing, and it's the
 * only option that works for a whole leaderboard at once (resolving each row via
 * the API would mean one request per player).
 */
export function pickAvatar(
  robloxAvatarImage: string | null | undefined,
  discordAvatar: string | null | undefined
): string {
  const stored = avatarUrl(robloxAvatarImage);
  if (stored && (!stored.startsWith("/api/avatar/") || localAvatarExists(stored))) {
    return stored;
  }
  return discordAvatar || "";
}

/** Like {@link pickAvatar}, but falls back to a live Discord API lookup when the
 *  bot hasn't synced an avatar URL yet. Single-player use only (it can make a
 *  network call) — list views must use pickAvatar. */
export async function resolvePlayerAvatar(
  playerName: string,
  robloxAvatarImage: string | null | undefined,
  discordAvatar?: string | null
): Promise<string> {
  const picked = pickAvatar(robloxAvatarImage, discordAvatar);
  if (picked) return picked;
  try {
    const discordId = await getDiscordIdForPlayer(playerName);
    if (discordId) {
      const discord = await getDiscordAvatarById(discordId);
      if (discord) return discord;
    }
  } catch {
    /* best-effort — callers keep their own fallback (initials) */
  }
  return "";
}
