/**
 * Auth helpers for Discord OAuth sessions.
 * Uses jose for JWT encoding/decoding of session cookies.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { UserSession } from "@/types";
import { liveIdentity } from "@/lib/session-store";

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

/** A session can be refreshed for at most this long after the Discord sign-in. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_S = 7 * 24 * 60 * 60;

/** Encode a user session into a signed JWT (7-day cookie, refreshed by /api/auth/me). */
export async function encodeSession(session: UserSession): Promise<string> {
  // Only identity claims go in the token; exp/iat are set here.
  const claims = { ...session } as Record<string, unknown>;
  delete claims.exp;
  delete claims.iat;
  delete claims.clubTag;
  return new SignJWT({ ...claims, authAt: session.authAt ?? Date.now(), epoch: session.epoch ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export type Claims = UserSession & { exp?: number; iat?: number };

async function verify(token: string): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    return payload as unknown as Claims;
  } catch {
    return null;
  }
}

/**
 * Check a verified token against the server (docs/WEBSITE_SECURITY_PLAN.md 1.3):
 * reject it past the 30-day cap or after "log out everywhere", and replace the
 * JWT's player name with the account's CURRENT link (by discord_id). If the
 * database can't be reached the token's own claims are used.
 */
export async function validateSessionClaims(claims: Claims): Promise<UserSession | null> {
  if (!claims.discordId) return null;
  // Tokens from before authAt existed: count from their original issue time.
  const authAt =
    typeof claims.authAt === "number"
      ? claims.authAt
      : typeof claims.iat === "number"
        ? claims.iat * 1000
        : typeof claims.exp === "number"
          ? (claims.exp - SESSION_TTL_S) * 1000
          : Date.now();
  if (Date.now() - authAt > SESSION_MAX_AGE_MS) return null;
  const session: UserSession = { ...claims, authAt, epoch: Number(claims.epoch ?? 0) || 0 };
  delete (session as Claims).exp;
  delete (session as Claims).iat;
  try {
    const live = await liveIdentity(claims.discordId);
    if (session.epoch! < live.epoch) return null;
    session.playerName = live.playerName;
  } catch (error) {
    console.error("session check failed; using token claims", error);
  }
  return session;
}

/** Decode and verify a session JWT (signature and expiry only — no server checks). */
export async function decodeSession(token: string): Promise<UserSession | null> {
  return verify(token);
}

/** Get the current user session from cookies (for use in API routes). The
 *  player name is the account's live link, not the one in the cookie. */
export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verify(token);
  return claims ? validateSessionClaims(claims) : null;
}

/** Session plus JWT expiry (unix seconds). Used so /api/auth/me can skip
 *  re-signing the cookie when identity hasn't changed and the token is still
 *  well inside its 7-day window. */
export async function getSessionWithExpiry(): Promise<{
  session: UserSession | null;
  exp: number | null;
}> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return { session: null, exp: null };
  const claims = await verify(token);
  if (!claims) return { session: null, exp: null };
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const session = await validateSessionClaims(claims);
  return { session, exp: session ? exp : null };
}

/** Discord OAuth2 URLs and config */
export const DISCORD_CONFIG = {
  clientId: process.env.DISCORD_CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  redirectUri: `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/auth/callback`,
  // The CBL bot's server, "CB Looters" (the CBL bot's GUILD_ID). Read from
  // DISCORD_GUILD_ID, not the old SFHL_GUILD_ID, so a stale SFHL value left
  // in the hosting env can't point the site back at the SFHL server.
  guildId: process.env.DISCORD_GUILD_ID || "1513293927950716998",
  // guilds.join lets login add the user to the HyperLeague Discord if they
  // aren't already in it (bot needs CREATE_INSTANT_INVITE in the guild).
  scopes: ["identify", "guilds", "guilds.join"],
  inviteUrl: "https://discord.gg/GpvjJjhF3t",
};

// Role IDs in that server — the same values as the CBL bot's config/settings.py.
/** Bloxlink assigns this after a member verifies their Roblox account. */
export const BLOXLINK_VERIFIED_ROLE_ID = "1554232318044930099";
/** Self-serve matchmaking access from the Discord /verifymessage button ("MM Acess"). */
export const MM_ACCESS_ROLE_ID = "1554232616603885638";
/** Match Staff ("Ranked Staff" in CB Looters). MATCH_STAFF_ROLE_ID overrides it. */
export const MATCH_STAFF_ROLE_ID = "1543883820879585343";
/** MatchMaking Manager (the CBL bot's MM_MANAGER_ROLE_ID: /season reset). MM_MANAGER_ROLE_ID overrides it. */
export const MM_MANAGER_ROLE_ID = "1554231558485839943";
const LEAGUE_ACCESS_ROLE_IDS = [BLOXLINK_VERIFIED_ROLE_ID, MM_ACCESS_ROLE_ID];

export type GuildPresence = {
  inGuild: boolean;
  /** True when the member has MM access or the Bloxlink verified role. */
  verified: boolean;
  /** True when they have the Get Matchmaking Access role. */
  mmAccess: boolean;
  /** Guild nickname, else Discord display name. */
  displayName?: string | null;
};

/**
 * Live guild membership + Bloxlink verified-role check via the bot token.
 * Returns `null` when it can't tell (no bot token / API error).
 */
export async function getGuildPresence(userId: string): Promise<GuildPresence | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_CONFIG.guildId}/members/${userId}`,
      { headers: { Authorization: `Bot ${token}` }, cache: "no-store" }
    );
    if (res.status === 404) return { inGuild: false, verified: false, mmAccess: false, displayName: null };
    if (!res.ok) return null;
    const member = (await res.json()) as {
      roles?: string[];
      nick?: string | null;
      user?: { username?: string; global_name?: string | null };
    };
    const roles = member.roles ?? [];
    const displayName =
      (member.nick || member.user?.global_name || member.user?.username || "").trim() || null;
    return {
      inGuild: true,
      verified: LEAGUE_ACCESS_ROLE_IDS.some((id) => roles.includes(id)),
      mmAccess: roles.includes(MM_ACCESS_ROLE_ID),
      displayName,
    };
  } catch {
    return null;
  }
}

export async function isUserInGuildById(userId: string): Promise<boolean | null> {
  const p = await getGuildPresence(userId);
  if (p === null) return null;
  return p.inGuild;
}

/** Per-instance cache of guild presence. Fully verified members stay cached
 *  longer; missing-server / missing-role must expire quickly so the invite
 *  and Bloxlink popups close soon after they join or verify. */
const presenceCache = new Map<string, { val: GuildPresence; at: number }>();
const presenceInflight = new Map<string, Promise<GuildPresence | null>>();
const PRESENCE_TTL_READY_MS = 5 * 60 * 1000;
const PRESENCE_TTL_PENDING_MS = 15 * 1000;

export function clearGuildPresenceCache(userId?: string) {
  if (userId) presenceCache.delete(userId);
  else presenceCache.clear();
}

export async function getGuildPresenceCached(userId: string): Promise<GuildPresence | null> {
  const hit = presenceCache.get(userId);
  if (hit) {
    const ready = hit.val.inGuild && hit.val.verified;
    const ttl = ready ? PRESENCE_TTL_READY_MS : PRESENCE_TTL_PENDING_MS;
    if (Date.now() - hit.at < ttl) return hit.val;
  }
  const pending = presenceInflight.get(userId);
  if (pending) return pending;
  const request = getGuildPresence(userId)
    .then((val) => {
      if (val !== null) presenceCache.set(userId, { val, at: Date.now() });
      return val;
    })
    .finally(() => {
      presenceInflight.delete(userId);
    });
  presenceInflight.set(userId, request);
  return request;
}

/** isUserInGuildById with a short-lived cache. Unknown (null) is not cached. */
export async function isUserInGuildCached(userId: string): Promise<boolean | null> {
  const p = await getGuildPresenceCached(userId);
  if (p === null) return null;
  return p.inGuild;
}

/** Add the OAuth user to the HyperLeague guild. Requires the `guilds.join`
 *  scope on their access token and CREATE_INSTANT_INVITE on the bot. */
export async function addUserToGuild(userId: string, accessToken: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_CONFIG.guildId}/members/${userId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
      }
    );
    // 201 = added, 204 = already a member.
    if (res.status === 201 || res.status === 204 || res.ok) {
      clearGuildPresenceCache(userId);
      return true;
    }
    console.error("guilds.join failed:", res.status, await res.text().catch(() => ""));
    return false;
  } catch {
    return false;
  }
}

/** Permanent Discord invite for users the website couldn't auto-add. */
export const DISCORD_INVITE_URL = "https://discord.gg/GpvjJjhF3t";

export async function getDiscordInviteUrl(): Promise<string | null> {
  return (
    process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ||
    process.env.DISCORD_INVITE_URL ||
    DISCORD_CONFIG.inviteUrl ||
    DISCORD_INVITE_URL
  );
}

/** Re-check Discord membership + Bloxlink role and return an updated session. */
export async function withLiveGuildFlag(session: UserSession): Promise<UserSession> {
  const live = await getGuildPresenceCached(session.discordId);
  if (live === null) return session;
  if (
    live.inGuild === session.inGuild &&
    session.verified === live.verified &&
    session.mmAccess === live.mmAccess
  ) {
    return session;
  }
  return { ...session, inGuild: live.inGuild, verified: live.verified, mmAccess: live.mmAccess };
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