import { NextResponse } from "next/server";
import {
  getSession,
  encodeSession,
  SESSION_COOKIE,
  withLiveGuildFlag,
  getDiscordInviteUrl,
} from "@/lib/auth";

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

  const fresh = await withLiveGuildFlag(session);
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
