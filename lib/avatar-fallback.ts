/**
 * Avatar fallbacks that are safe in the browser. A Discord CDN avatar link goes
 * dead when the player changes their picture; the link still carries their
 * account id, so it can fall back to that account's default Discord avatar.
 */

const GENERIC_DISCORD_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";
const DISCORD_USER_IN_URL = /cdn\.discordapp\.com\/(?:avatars|guilds\/\d+\/users)\/(\d{15,22})\//;

/** Discord's default embed avatar for an account id (what Discord shows with no custom picture). */
export function defaultDiscordAvatar(discordId: string | number | bigint): string {
  try {
    const idx = Number((BigInt(discordId) >> BigInt(22)) % BigInt(6));
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return GENERIC_DISCORD_AVATAR;
  }
}

/** What to show when `url` fails to load: the account's default Discord avatar, or a generic one. */
export function avatarFallbackFor(url: string | null | undefined): string {
  const id = url?.match(DISCORD_USER_IN_URL)?.[1];
  return id ? defaultDiscordAvatar(id) : GENERIC_DISCORD_AVATAR;
}
