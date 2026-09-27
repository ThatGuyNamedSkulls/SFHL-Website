import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { bumpSessionEpoch } from "@/lib/session-store";

// POST only — logout clears the session cookie, so it must not be reachable via
// GET. A GET handler here was being prefetched by the App Router's <Link>,
// silently logging users out in the background. Clients call this with
// fetch(..., { method: "POST" }) (see components/logout-button.tsx).
//
// `?everywhere=1` also invalidates every other session of this account (other
// browsers, a stolen cookie) by bumping its session epoch.
export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get("everywhere") === "1") {
    const session = await getSession();
    if (session) {
      try {
        await bumpSessionEpoch(session.discordId);
      } catch (error) {
        console.error("log out everywhere failed", error);
        return NextResponse.json({ error: "Could not log out other devices." }, { status: 500 });
      }
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
