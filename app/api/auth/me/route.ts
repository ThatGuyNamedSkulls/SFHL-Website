import { NextResponse } from "next/server";
import {
  getSession,
  encodeSession,
  SESSION_COOKIE,
  withLiveGuildFlag,
  getDiscordInviteUrl,
} from "@/lib/auth";
import { getPlayerByDiscordId } from "@/lib/db";
import { UserSession } from "@/types";

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

// Never cache this: it's per-user and read on every navigation. A cached
// `{ user: null }` (e.g. from before login, or from another visitor via a CDN)
// is exactly what made the site intermittently show "logged out".
export const dynamic = "force-dynamic";

/** Returns the current logged-in user's session, or null. */
export async function GET() {
  const session = await getSession();

  const noStore = { "Cache-Control": "no-store, max-age=0" };
  const discordInvite = await getDiscordInviteUrl();

  if (!session) {
    return NextResponse.json({ user: null, discordInvite }, { headers: noStore });
  }

  const fresh = await withLivePlayerIdentity(await withLiveGuildFlag(session));
  const res = NextResponse.json({ user: fresh, discordInvite }, { headers: noStore });

  // Sliding session: re-issue the cookie on each check so an actively-browsing
  // user never hits the 7-day hard expiry (and gets bumped to the login page)
  // while they're still using the site. Also persist a live guild-membership
  // flip (joined/left Discord) so queue no longer trusts the login-time flag.
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
