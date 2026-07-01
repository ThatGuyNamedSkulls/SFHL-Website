import { NextResponse } from "next/server";
import { DISCORD_CONFIG } from "@/lib/auth";

/** Redirect user to Discord OAuth2 authorize URL */
export async function GET() {
  const params = new URLSearchParams({
    client_id: DISCORD_CONFIG.clientId,
    redirect_uri: DISCORD_CONFIG.redirectUri,
    response_type: "code",
    scope: DISCORD_CONFIG.scopes.join(" "),
  });

  return NextResponse.redirect(
    `https://discord.com/api/oauth2/authorize?${params.toString()}`
  );
}
