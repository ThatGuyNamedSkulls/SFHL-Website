import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// POST only — logout clears the session cookie, so it must not be reachable via
// GET. A GET handler here was being prefetched by the App Router's <Link>,
// silently logging users out in the background. Clients call this with
// fetch(..., { method: "POST" }) (see components/logout-button.tsx).
export async function POST() {
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
