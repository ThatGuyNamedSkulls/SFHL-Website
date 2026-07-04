import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { DISCORD_CONFIG, OAUTH_STATE_COOKIE } from "@/lib/auth";

/** Redirect user to Discord OAuth2 authorize URL.
 *
 * A random `state` is generated, sent to Discord, and stored in a short-lived
 * httpOnly cookie. The callback rejects any response whose `state` doesn't match
 * the cookie — this is the standard OAuth CSRF defence (stops an attacker from
 * completing a login flow in the victim's browser with the attacker's code). */
export async function GET() {
  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: DISCORD_CONFIG.clientId,
    redirect_uri: DISCORD_CONFIG.redirectUri,
    response_type: "code",
    scope: DISCORD_CONFIG.scopes.join(" "),
    state,
  });

  const response = NextResponse.redirect(
    `https://discord.com/api/oauth2/authorize?${params.toString()}`
  );
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 30, // 30 minutes to complete the flow
    path: "/",
  });
  return response;
}
