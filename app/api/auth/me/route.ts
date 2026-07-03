import { NextResponse } from "next/server";
import { getSession, encodeSession, SESSION_COOKIE } from "@/lib/auth";

// Never cache this: it's per-user and read on every navigation. A cached
// `{ user: null }` (e.g. from before login, or from another visitor via a CDN)
// is exactly what made the site intermittently show "logged out".
export const dynamic = "force-dynamic";

/** Returns the current logged-in user's session, or null. */
export async function GET() {
  const session = await getSession();

  const noStore = { "Cache-Control": "no-store, max-age=0" };

  if (!session) {
    return NextResponse.json({ user: null }, { headers: noStore });
  }

  const res = NextResponse.json({ user: session }, { headers: noStore });

  // Sliding session: re-issue the cookie on each check so an actively-browsing
  // user never hits the 7-day hard expiry (and gets bumped to the login page)
  // while they're still using the site. Best-effort — if re-signing fails we
  // still return the valid session we already decoded.
  try {
    const jwt = await encodeSession(session);
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
