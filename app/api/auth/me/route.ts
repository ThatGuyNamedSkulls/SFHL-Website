import { NextResponse } from "next/server";
import {
  getSessionWithExpiry,
  encodeSession,
  SESSION_COOKIE,
  withLiveGuildFlag,
  getDiscordInviteUrl,
} from "@/lib/auth";
import { getPlayerByDiscordId, getPlayerCoins, setPlayerMmAccess } from "@/lib/db";
import { UserSession } from "@/types";
import { clubTagIndex, lookupClubTag } from "@/lib/clubs";

/** Session cookies can outlive a Discord nick change. Re-read the linked
 *  players row by discord_id so "My profile" uses the current website name. */
async function withLivePlayerIdentity(session: UserSession): Promise<UserSession> {
  try {
    const player = await getPlayerByDiscordId(session.discordId);
    if (!player) return session;
    const dbHandle = (player.discord_username || "").trim() || null;
    const priorName = (session.username || "").trim() || null;
    const handle =
      dbHandle && dbHandle.toLowerCase() !== player.name.toLowerCase()
        ? dbHandle
        : session.discordUsername ||
          (priorName && priorName.toLowerCase() !== player.name.toLowerCase() ? priorName : dbHandle);
    if (
      session.playerName === player.name &&
      session.username === player.name &&
      (session.discordUsername ?? null) === handle
    ) {
      return session;
    }
    return {
      ...session,
      playerName: player.name,
      username: player.name,
      discordUsername: handle,
    };
  } catch {
    return session;
  }
}

function sessionNeedsCookieWrite(before: UserSession, after: UserSession, exp: number | null): boolean {
  if (before.playerName !== after.playerName) return true;
  if (before.username !== after.username) return true;
  if ((before.discordUsername ?? null) !== (after.discordUsername ?? null)) return true;
  if (before.inGuild !== after.inGuild) return true;
  if (before.verified !== after.verified) return true;
  if (before.mmAccess !== after.mmAccess) return true;
  if (before.avatar !== after.avatar) return true;
  // Sliding 7-day session: re-issue when less than 6 days remain so daily
  // use never expires, without signing a new JWT on every chrome poll.
  if (exp == null) return true;
  return exp * 1000 - Date.now() < 6 * 24 * 60 * 60 * 1000;
}

// Never cache this: it's per-user and read on every navigation. A cached
// `{ user: null }` (e.g. from before login, or from another visitor via a CDN)
// is exactly what made the site intermittently show "logged out".
export const dynamic = "force-dynamic";

/** Returns the current logged-in user's session, or null. */
export async function GET() {
  const { session, exp } = await getSessionWithExpiry();

  const noStore = { "Cache-Control": "no-store, max-age=0" };
  const discordInvite = await getDiscordInviteUrl();

  if (!session) {
    return NextResponse.json({ user: null, discordInvite, coins: 0 }, { headers: noStore });
  }

  const fresh = await withLivePlayerIdentity(await withLiveGuildFlag(session));
  if (fresh.mmAccess !== session.mmAccess) {
    setPlayerMmAccess(fresh.discordId, !!fresh.mmAccess).catch(() => {});
  }
  const coins = fresh.playerName
    ? await getPlayerCoins(fresh.playerName).catch(() => 0)
    : 0;
  const tags = await clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} }));
  const user = {
    ...fresh,
    clubTag: lookupClubTag(tags, fresh.playerName, fresh.discordId),
  };
  const res = NextResponse.json({ user, discordInvite, coins }, { headers: noStore });

  if (!sessionNeedsCookieWrite(session, fresh, exp)) return res;

  // Sliding session: re-issue the cookie so an actively-browsing user never
  // hits the 7-day hard expiry. Also persist a live guild-membership flip.
  try {
    const jwt = await encodeSession(fresh);
    res.cookies.set(SESSION_COOKIE, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
  } catch {
    /* keep serving the session even if the refresh write fails */
  }

  return res;
}
