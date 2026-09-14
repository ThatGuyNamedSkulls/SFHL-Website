/**
 * Server-side avatar resolution.
 *
 * The website prefers a *live* Discord profile picture (stored CDN hashes go
 * stale and 404, which is what turned avatars into two-letter fallbacks).
 * Roblox files live on the bot host and 404 on Vercel, so they are last resort.
 */

import { existsSync } from "fs";
import path from "path";
import { avatarUrl } from "@/lib/format";
import { getDiscordIdForPlayer } from "@/lib/social";
import { getDiscordAvatarById } from "@/lib/auth";

/** Discord's default embed avatar when we have an id but no custom hash. */
export function defaultDiscordAvatar(discordId: string | number | bigint): string {
  try {
    const id = BigInt(discordId);
    const idx = Number((id >> BigInt(22)) % BigInt(6));
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}

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

function snowflake(id: string | number | bigint | null | undefined): string {
  if (id == null) return "";
  const s = String(id).trim();
  return /^\d{15,22}$/.test(s) ? s : "";
}

/**
 * Best avatar URL for list views (no extra network).
 *
 * 1. Discord CDN URL the bot/login stored
 * 2. Discord default avatar from discord id
 * 3. Roblox file, only if it actually exists on this host
 */
export function pickAvatar(
  robloxAvatarImage: string | null | undefined,
  discordAvatar: string | null | undefined,
  discordId?: string | number | null
): string {
  if (discordAvatar && /^https?:\/\//i.test(discordAvatar)) return discordAvatar;
  const id = snowflake(discordId);
  if (id) return defaultDiscordAvatar(id);
  const stored = avatarUrl(robloxAvatarImage);
  if (stored && (!stored.startsWith("/api/avatar/") || localAvatarExists(stored))) {
    return stored;
  }
  return "";
}

/** Live Discord PFP when we have (or can look up) a snowflake. Cached in auth. */
export async function resolvePlayerAvatar(
  playerName: string,
  robloxAvatarImage: string | null | undefined,
  discordAvatar?: string | null,
  discordId?: string | number | null
): Promise<string> {
  let id = snowflake(discordId);
  if (!id && playerName) {
    try {
      id = snowflake(await getDiscordIdForPlayer(playerName));
    } catch {
      /* web_users may be empty */
    }
  }
  if (id) {
    try {
      const live = await getDiscordAvatarById(id);
      if (live) return live;
    } catch {
      /* bot token missing / Discord down */
    }
    return defaultDiscordAvatar(id);
  }
  return pickAvatar(robloxAvatarImage, discordAvatar, discordId);
}

export async function resolveAvatarMap(
  rows: {
    name: string;
    roblox_avatar_image?: string | null;
    discord_avatar?: string | null;
    discord_id?: string | number | null;
  }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    rows.map(async (r) => {
      const url = await resolvePlayerAvatar(
        r.name,
        r.roblox_avatar_image,
        r.discord_avatar,
        r.discord_id
      );
      if (url) map.set(r.name, url);
    })
  );
  return map;
}

export async function resolveAvatarsByDiscordId(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.map(snowflake).filter(Boolean))];
  await Promise.all(
    unique.map(async (id) => {
      try {
        const live = await getDiscordAvatarById(id);
        map.set(id, live || defaultDiscordAvatar(id));
      } catch {
        map.set(id, defaultDiscordAvatar(id));
      }
    })
  );
  return map;
}
