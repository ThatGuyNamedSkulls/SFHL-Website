import { NextResponse } from "next/server";
import { DISCORD_CONFIG, encodeSession, isUserInGuildById, SESSION_COOKIE } from "@/lib/auth";
import { getPlayer } from "@/lib/db";
import { upsertWebUser } from "@/lib/social";
import { avatarUrl } from "@/lib/format";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/login?error=no_code`
    );
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CONFIG.clientId,
        client_secret: DISCORD_CONFIG.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_CONFIG.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/login?error=token_failed`
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json();

    // Determine SFHL membership by Discord user ID via the bot token — the
    // guild tells us directly whether this account is a member, regardless of
    // display name. Fall back to the user's OAuth guilds list only if the
    // bot-token lookup is unavailable (e.g. DISCORD_BOT_TOKEN not set).
    let inGuild = await isUserInGuildById(userData.id);
    if (inGuild === null) {
      const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const guildsData = await guildsRes.json();
      inGuild =
        Array.isArray(guildsData) &&
        guildsData.some((g: { id: string }) => g.id === DISCORD_CONFIG.guildId);
    }

    // Try to match Discord username to a player in the database
    const displayName = userData.global_name || userData.username;
    let avatar = userData.avatar
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
      : null;
    let rank = "UNRANKED";

    const playerData = await getPlayer(displayName);
    const playerName = playerData ? playerData.name : null;
    
    if (playerData) {
      if (playerData.roblox_avatar_image) {
        avatar = avatarUrl(playerData.roblox_avatar_image);
      }
      rank = playerData.rank || "UNRANKED";
    }

    // Create session
    const session = {
      discordId: userData.id,
      username: userData.global_name || userData.username,
      avatar: avatar,
      discriminator: userData.discriminator || "0",
      playerName,
      inGuild,
    };

    // Remember this player's Discord id so the bot can DM them by id later.
    try {
      await upsertWebUser(session.discordId, session.playerName, session.username);
    } catch (e) {
      console.error("Failed to record web_user mapping:", e);
    }

    const jwt = await encodeSession(session);

    // Set cookie and redirect
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const response = NextResponse.redirect(`${baseUrl}/profile`);
    response.cookies.set(SESSION_COOKIE, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/login?error=server_error`
    );
  }
}
