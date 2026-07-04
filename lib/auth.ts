/**
 * Auth helpers for Discord OAuth sessions.
 * Uses jose for JWT encoding/decoding of session cookies.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { UserSession } from "@/types";

const SESSION_COOKIE = "hl_session";
/** Short-lived cookie holding the OAuth `state` value, to defend the login
 *  callback against CSRF (an attacker can't forge a request carrying a `state`
 *  that matches the victim's cookie). Set in /api/auth/discord, checked in
 *  /api/auth/callback. */
const OAUTH_STATE_COOKIE = "hl_oauth_state";

let _secret: Uint8Array | null = null;

/**
 * The session-signing key. Resolved lazily (at first sign/verify, not at import
 * or build) so we can fail fast at runtime: in production a missing
 * NEXTAUTH_SECRET throws rather than silently signing sessions with the public
 * dev fallback — which would let anyone forge a fully-trusted session cookie.
 */
function getSecret(): Uint8Array {
  if (_secret) return _secret;
  const s = process.env.NEXTAUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET is not set. Refusing to sign/verify sessions with the " +
        "public dev fallback in production."
    );
  }
  _secret = new TextEncoder().encode(s || "hyperleague-dev-secret-change-me-in-prod");
  return _secret;
}

/** Encode a user session into a signed JWT */
export async function encodeSession(session: UserSession): Promise<string> {
  return new SignJWT(session as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(getSecret());
}

/** Decode and verify a session JWT */
export async function decodeSession(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

/** Get the current user session from cookies (for use in API routes) */
export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decodeSession(token);
}

/** Discord OAuth2 URLs and config */
export const DISCORD_CONFIG = {
  clientId: process.env.DISCORD_CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  redirectUri: `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/auth/callback`,
  guildId: process.env.SFHL_GUILD_ID || "973987866336190484",
  scopes: ["identify", "guilds"],
};

/**
 * Check guild membership by Discord user ID using the bot token.
 *
 * This is authoritative — it asks the guild directly whether that user ID is a
 * member — instead of matching a display name or trusting the user's OAuth
 * `guilds` scope. Returns `null` when it can't tell (no bot token configured or
 * the API errored) so callers can fall back.
 */
export async function isUserInGuildById(userId: string): Promise<boolean | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_CONFIG.guildId}/members/${userId}`,
      { headers: { Authorization: `Bot ${token}` }, cache: "no-store" }
    );
    if (res.status === 404) return false; // definitively not a member
    if (!res.ok) return null; // rate-limited / permission issue -> unknown
    return true;
  } catch {
    return null;
  }
}

/** Per-instance cache of guild-membership checks. The parties/queue endpoints
 *  are polled every few seconds, so raw per-member Discord API calls would
 *  burn rate limit; definitive answers are cached for a few minutes. */
const guildCache = new Map<string, { val: boolean; at: number }>();
const GUILD_CACHE_TTL_MS = 5 * 60 * 1000;

/** isUserInGuildById with a short-lived cache. Unknown (null) is not cached. */
export async function isUserInGuildCached(userId: string): Promise<boolean | null> {
  const hit = guildCache.get(userId);
  if (hit && Date.now() - hit.at < GUILD_CACHE_TTL_MS) return hit.val;
  const val = await isUserInGuildById(userId);
  if (val !== null) guildCache.set(userId, { val, at: Date.now() });
  return val;
}

/** Per-instance cache of Discord avatar URLs (the queue page polls every 5s;
 *  without this every poll would hit the Discord API and burn rate limit). */
const avatarCache = new Map<string, { url: string | null; at: number }>();
const AVATAR_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve a user's Discord profile picture by user ID using the bot token.
 * Falls back to Discord's default embed avatar when the user has no custom
 * one, and returns `null` when it can't tell (no bot token / API error).
 */
export async function getDiscordAvatarById(userId: string): Promise<string | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const hit = avatarCache.get(userId);
  if (hit && Date.now() - hit.at < AVATAR_CACHE_TTL_MS) return hit.url;
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return hit?.url ?? null;
    const user = (await res.json()) as { avatar?: string | null };
    const url = user.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userId) >> BigInt(22)) % BigInt(6))}.png`;
    avatarCache.set(userId, { url, at: Date.now() });
    return url;
  } catch {
    return hit?.url ?? null;
  }
}

export { SESSION_COOKIE, OAUTH_STATE_COOKIE };
