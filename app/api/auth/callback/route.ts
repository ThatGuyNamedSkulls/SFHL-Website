import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DISCORD_CONFIG,
  encodeSession,
  getGuildPresence,
  addUserToGuild,
  SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/auth";
import { getPlayerByDiscordId, setPlayerDiscordIdentity, setPlayerMmAccess } from "@/lib/db";
import { upsertWebUser } from "@/lib/social";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/login?error=no_code`
    );
  }

  // CSRF check: the `state` echoed back by Discord must match the one we set in
  // the httpOnly cookie when starting the flow. A missing/mismatched state means
  // this callback wasn't initiated by us in this browser ΓÇö reject it.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    const res = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/login?error=bad_state`
    );
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
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

    // Determine SFHL membership by Discord user ID via the bot token. If they
    // aren't in the guild yet, add them with the guilds.join OAuth grant.
    let presence = await getGuildPresence(userData.id);
    if (presence === null) {
      const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const guildsData = await guildsRes.json();
      const listed =
        Array.isArray(guildsData) &&
        guildsData.some((g: { id: string }) => g.id === DISCORD_CONFIG.guildId);
      presence = { inGuild: listed, verified: false, mmAccess: false, displayName: null };
    }
    if (!presence.inGuild) {
      const joined = await addUserToGuild(userData.id, accessToken);
      if (joined) {
        presence = (await getGuildPresence(userData.id)) ?? {
          inGuild: true,
          verified: false,
          mmAccess: false,
          displayName: null,
        };
      }
    }
    const inGuild = presence.inGuild;
    const verified = presence.verified;
    const mmAccess = presence.mmAccess;

    // Match the Discord account to a player the bot enrolled after Bloxlink
    // verification. Login never creates a players row.
    const discordAvatar = userData.avatar
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userData.id) >> BigInt(22)) % BigInt(6))}.png`;
    const avatar: string | null = discordAvatar;

    const playerData = await getPlayerByDiscordId(userData.id);
    const playerName = playerData ? playerData.name : null;
    const displayName =
      playerName ||
      presence.displayName ||
      userData.global_name ||
      userData.username;

    // Create session
    const session = {
      discordId: userData.id,
      username: displayName,
      discordUsername: userData.username ?? null,
      avatar: avatar,
      discriminator: userData.discriminator || "0",
      playerName,
      inGuild,
      verified,
      mmAccess,
    };

    // Remember this player's Discord id so the bot can DM them by id later.
    try {
      await upsertWebUser(session.discordId, session.playerName, session.username);
    } catch (e) {
      console.error("Failed to record web_user mapping:", e);
    }

    // Record this user's @handle on their own player row immediately, so the
    // "name (@handle)" display works before the bot's hourly guild sync runs.
    if (playerName && userData.username) {
      try {
        await setPlayerDiscordIdentity(playerName, userData.id, userData.username, discordAvatar);
      } catch (e) {
        console.error("Failed to record Discord identity:", e);
      }
    }

    if (playerName) {
      try {
        await setPlayerMmAccess(userData.id, mmAccess);
      } catch (e) {
        console.error("Failed to record MM access flag:", e);
      }
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
    // Consume the one-time state cookie now that the flow completed.
    response.cookies.delete(OAUTH_STATE_COOKIE);

    return response;
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/login?error=server_error`
    );
  }
}
