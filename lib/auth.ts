/**
 * Auth helpers for Discord OAuth sessions.
 * Uses jose for JWT encoding/decoding of session cookies.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { UserSession } from "@/types";

const SESSION_COOKIE = "hl_session";
const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "hyperleague-dev-secret-change-me-in-prod"
);

/** Encode a user session into a signed JWT */
export async function encodeSession(session: UserSession): Promise<string> {
  return new SignJWT(session as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET);
}

/** Decode and verify a session JWT */
export async function decodeSession(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
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

export { SESSION_COOKIE };
