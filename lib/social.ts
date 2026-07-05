/**
 * Social layer for HyperLeague: friends + friend requests, party invites,
 * website notifications, and a Discord-DM outbox the bot drains.
 *
 * Identity is the **player name** (unique in the `players` table). Every SFHL
 * player has one, profiles are addressed by it, and — because the bot links
 * Discord members by display name — the bot can resolve a player name back to a
 * guild member to DM them. That means friends work against the real player base
 * instead of only people who've logged into the website.
 *
 * The tables (created in core/schema.py and lazily here) use generic id columns
 * that now hold player names.
 */

import { client, mapRank } from "@/lib/db";
import { avatarUrl } from "@/lib/format";

export interface Friend {
  name: string;
  avatar: string | null;
  /** Rank tier letter (mapped from the DB rank string). */
  rank: string;
  country: string | null;
  /** Discord @handle for "name (@handle)" display (null until synced). */
  discordUsername: string | null;
}

export interface FriendRequestView {
  /** The other player's name (requests are keyed by pair). */
  name: string;
  friend: Friend;
  createdAt: number;
}

export interface NotificationView {
  id: number;
  type: string;
  message: string;
  /** For friend_request: the requester's player name. */
  actorId: string | null;
  /** For party_invite: the party id. */
  refId: string | null;
  read: boolean;
  createdAt: number;
}

let schemaReady: Promise<void> | null = null;

/** Create the social tables once per process (idempotent, mirrors core/schema.py). */
export function ensureSocialSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.batch([
        // Maps a player name -> their Discord id, captured whenever the website
        // knows both (login/queue/party). Lets the bot DM by user id instead of
        // guessing a member by display name.
        `CREATE TABLE IF NOT EXISTS web_users (
           discord_id TEXT PRIMARY KEY, player_name TEXT, username TEXT,
           updated_at INTEGER )`,
        `CREATE TABLE IF NOT EXISTS friendships (
           user_a TEXT NOT NULL, user_b TEXT NOT NULL, created_at INTEGER,
           PRIMARY KEY (user_a, user_b) )`,
        `CREATE TABLE IF NOT EXISTS friend_requests (
           from_id TEXT NOT NULL, to_id TEXT NOT NULL, created_at INTEGER,
           PRIMARY KEY (from_id, to_id) )`,
        `CREATE TABLE IF NOT EXISTS party_invites (
           party_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
           created_at INTEGER, PRIMARY KEY (party_id, to_id) )`,
        `CREATE TABLE IF NOT EXISTS notifications (
           id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
           type TEXT NOT NULL, message TEXT NOT NULL, actor_id TEXT, ref_id TEXT,
           read INTEGER NOT NULL DEFAULT 0, created_at INTEGER )`,
        `CREATE TABLE IF NOT EXISTS discord_dm_outbox (
           id INTEGER PRIMARY KEY AUTOINCREMENT, to_id TEXT NOT NULL,
           message TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER )`,
      ]);
    })();
  }
  return schemaReady;
}

/** Canonical (sorted) friendship pair so a friendship is stored once. */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const now = () => Date.now();

// --- name <-> Discord id mapping -------------------------------------------

/** Record that this Discord id is linked to this player name (call wherever a
 *  session with both is available: login, queue join, party membership). */
export async function upsertWebUser(
  discordId: string,
  playerName: string | null,
  username: string | null
): Promise<void> {
  if (!playerName) return; // only useful once linked to a player
  await ensureSocialSchema();
  await client.execute({
    sql: `INSERT INTO web_users (discord_id, player_name, username, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            player_name = excluded.player_name,
            username = excluded.username,
            updated_at = excluded.updated_at`,
    args: [discordId, playerName, username, now()],
  });
}

/** Look up a known Discord id for a player name, if we've ever seen them. */
export async function getDiscordIdForPlayer(name: string): Promise<string | null> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT discord_id FROM web_users WHERE player_name = ? ORDER BY updated_at DESC LIMIT 1",
    args: [name],
  });
  return (rs.rows[0]?.discord_id as string) ?? null;
}

// --- player directory (from the real players table) ------------------------

function rowToFriend(r: Record<string, unknown>): Friend {
  return {
    name: r.name as string,
    rank: mapRank((r.rank as string) || ""),
    avatar: avatarUrl(r.roblox_avatar_image as string | null),
    country: (r.country as string) ?? null,
    discordUsername: (r.discord_username as string) ?? null,
  };
}

async function resolvePlayers(names: string[]): Promise<Map<string, Friend>> {
  const map = new Map<string, Friend>();
  if (names.length === 0) return map;
  const placeholders = names.map(() => "?").join(",");
  const rs = await client.execute({
    sql: `SELECT name, rank, roblox_avatar_image, country, discord_username FROM players WHERE name IN (${placeholders})`,
    args: names,
  });
  for (const r of rs.rows as unknown as Record<string, unknown>[]) {
    map.set(r.name as string, rowToFriend(r));
  }
  // Fill unknowns so callers always have something to render.
  for (const n of names) {
    if (!map.has(n)) map.set(n, { name: n, rank: "UNRANKED", avatar: null, country: null, discordUsername: null });
  }
  return map;
}

/** Does a player with this exact name exist? */
export async function playerExists(name: string): Promise<boolean> {
  const rs = await client.execute({ sql: "SELECT 1 FROM players WHERE name = ?", args: [name] });
  return rs.rows.length > 0;
}

/** Search the player base by name to add friends (excludes yourself). */
export async function searchPlayers(query: string, selfName: string): Promise<Friend[]> {
  const rs = await client.execute({
    sql: `SELECT name, rank, roblox_avatar_image, country, discord_username FROM players
          WHERE name != ? AND name LIKE ? ORDER BY name LIMIT 20`,
    args: [selfName, `%${query.trim()}%`],
  });
  return (rs.rows as unknown as Record<string, unknown>[]).map(rowToFriend);
}

// --- friends ---------------------------------------------------------------

export async function areFriends(a: string, b: string): Promise<boolean> {
  await ensureSocialSchema();
  const [x, y] = pair(a, b);
  const rs = await client.execute({
    sql: "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?",
    args: [x, y],
  });
  return rs.rows.length > 0;
}

export async function getFriends(name: string): Promise<Friend[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT user_a, user_b FROM friendships WHERE user_a = ? OR user_b = ?",
    args: [name, name],
  });
  const names = rs.rows.map((r) =>
    (r.user_a as string) === name ? (r.user_b as string) : (r.user_a as string)
  );
  const players = await resolvePlayers(names);
  return names.map((n) => players.get(n)!);
}

async function requestExists(from: string, to: string): Promise<boolean> {
  const rs = await client.execute({
    sql: "SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?",
    args: [from, to],
  });
  return rs.rows.length > 0;
}

/**
 * Send a friend request between player names. If the target already invited the
 * sender, the two become friends immediately. Returns a short status.
 */
export async function sendFriendRequest(
  fromName: string,
  toName: string
): Promise<"sent" | "friends" | "exists" | "self" | "no_such_player"> {
  await ensureSocialSchema();
  if (fromName === toName) return "self";
  if (!(await playerExists(toName))) return "no_such_player";
  if (await areFriends(fromName, toName)) return "friends";

  if (await requestExists(toName, fromName)) {
    await acceptFriendRequest(fromName, toName);
    return "friends";
  }
  if (await requestExists(fromName, toName)) return "exists";

  await client.execute({
    sql: "INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)",
    args: [fromName, toName, now()],
  });
  await addNotification(toName, "friend_request", `${fromName} sent you a friend request.`, fromName);
  await enqueueDM(
    toName,
    `👋 **${fromName}** sent you a friend request on HyperLeague. Accept it here: https://sf-hl.com/friends`
  );
  return "sent";
}

/** Accept the request `fromName -> meName` (creates the friendship). Idempotent:
 *  only notifies/DMs the requester on the genuine first accept, and clears the
 *  originating notification so it can't be re-actioned (which would re-DM). */
export async function acceptFriendRequest(meName: string, fromName: string): Promise<void> {
  await ensureSocialSchema();
  const pending = await requestExists(fromName, meName);
  // Always clear any stale request/notification for this pair.
  await client.batch([
    { sql: "DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?", args: [fromName, meName] },
    { sql: "DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?", args: [meName, fromName] },
    { sql: "DELETE FROM notifications WHERE user_id = ? AND type = 'friend_request' AND actor_id = ?", args: [meName, fromName] },
  ]);
  // Only actually befriend + notify when there was a real request to accept —
  // otherwise POST /api/friends/accept could conjure a friendship (and a DM to
  // the target) with no handshake.
  if (!pending) return;
  const [x, y] = pair(meName, fromName);
  await client.execute({
    sql: "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)",
    args: [x, y, now()],
  });
  await addNotification(fromName, "friend_accepted", `${meName} accepted your friend request.`, meName);
  await enqueueDM(fromName, `✅ **${meName}** accepted your friend request on HyperLeague.`);
}

export async function rejectFriendRequest(meName: string, fromName: string): Promise<void> {
  await ensureSocialSchema();
  await client.batch([
    { sql: "DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?", args: [fromName, meName] },
    { sql: "DELETE FROM notifications WHERE user_id = ? AND type = 'friend_request' AND actor_id = ?", args: [meName, fromName] },
  ]);
}

export async function removeFriend(meName: string, otherName: string): Promise<void> {
  await ensureSocialSchema();
  const [x, y] = pair(meName, otherName);
  await client.execute({
    sql: "DELETE FROM friendships WHERE user_a = ? AND user_b = ?",
    args: [x, y],
  });
}

export async function getIncomingRequests(meName: string): Promise<FriendRequestView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT from_id, created_at FROM friend_requests WHERE to_id = ? ORDER BY created_at DESC",
    args: [meName],
  });
  const names = rs.rows.map((r) => r.from_id as string);
  const players = await resolvePlayers(names);
  return rs.rows.map((r) => ({
    name: r.from_id as string,
    friend: players.get(r.from_id as string)!,
    createdAt: Number(r.created_at ?? 0),
  }));
}

export async function getOutgoingRequests(meName: string): Promise<FriendRequestView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT to_id, created_at FROM friend_requests WHERE from_id = ? ORDER BY created_at DESC",
    args: [meName],
  });
  const names = rs.rows.map((r) => r.to_id as string);
  const players = await resolvePlayers(names);
  return rs.rows.map((r) => ({
    name: r.to_id as string,
    friend: players.get(r.to_id as string)!,
    createdAt: Number(r.created_at ?? 0),
  }));
}

// --- party invites ---------------------------------------------------------

/**
 * Record a party invite (target = player name) + notify/DM them — but only if
 * one isn't already pending, so re-inviting the same person doesn't spam them
 * with duplicate notifications/DMs. Returns "sent" or "pending".
 */
export async function createPartyInvite(
  partyId: string,
  fromName: string,
  toName: string,
  partyName: string
): Promise<"sent" | "pending"> {
  await ensureSocialSchema();
  if (await hasPartyInvite(partyId, toName)) return "pending";

  await client.execute({
    sql: "INSERT INTO party_invites (party_id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)",
    args: [partyId, fromName, toName, now()],
  });
  await addNotification(
    toName,
    "party_invite",
    `${fromName} invited you to the party "${partyName}".`,
    fromName,
    partyId
  );
  await enqueueDM(
    toName,
    `🎉 **${fromName}** invited you to their party "${partyName}" on HyperLeague. Join here: https://sf-hl.com/party-finder`
  );
  return "sent";
}

/** Map of party id -> invited player names, for the parties currently listed. */
export async function getInvitesForParties(partyIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (partyIds.length === 0) return map;
  await ensureSocialSchema();
  const placeholders = partyIds.map(() => "?").join(",");
  const rs = await client.execute({
    sql: `SELECT party_id, to_id FROM party_invites WHERE party_id IN (${placeholders})`,
    args: partyIds,
  });
  for (const r of rs.rows) {
    const pid = r.party_id as string;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(r.to_id as string);
  }
  return map;
}

export async function hasPartyInvite(partyId: string, toName: string): Promise<boolean> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT 1 FROM party_invites WHERE party_id = ? AND to_id = ?",
    args: [partyId, toName],
  });
  return rs.rows.length > 0;
}

export async function clearPartyInvite(partyId: string, toName: string): Promise<void> {
  await ensureSocialSchema();
  await client.batch([
    { sql: "DELETE FROM party_invites WHERE party_id = ? AND to_id = ?", args: [partyId, toName] },
    { sql: "DELETE FROM notifications WHERE user_id = ? AND type = 'party_invite' AND ref_id = ?", args: [toName, partyId] },
  ]);
}

/**
 * Drop all invites (and their party_invite notifications) for parties that no
 * longer exist — called when the party store prunes expired/empty parties, so a
 * notification can't outlive its party and leave the user with an un-joinable
 * invite forever.
 */
export async function clearInvitesForParties(partyIds: string[]): Promise<void> {
  if (partyIds.length === 0) return;
  await ensureSocialSchema();
  const placeholders = partyIds.map(() => "?").join(",");
  await client.batch([
    { sql: `DELETE FROM party_invites WHERE party_id IN (${placeholders})`, args: partyIds },
    {
      sql: `DELETE FROM notifications WHERE type = 'party_invite' AND ref_id IN (${placeholders})`,
      args: partyIds,
    },
  ]);
}

export async function getPartyInvitePartyIds(meName: string): Promise<string[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT party_id FROM party_invites WHERE to_id = ?",
    args: [meName],
  });
  return rs.rows.map((r) => r.party_id as string);
}

// --- notifications ---------------------------------------------------------

export async function addNotification(
  userName: string,
  type: string,
  message: string,
  actorName: string | null = null,
  refId: string | null = null
): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: `INSERT INTO notifications (user_id, type, message, actor_id, ref_id, read, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)`,
    args: [userName, type, message, actorName, refId, now()],
  });
}

export async function getNotifications(meName: string, limit = 30): Promise<NotificationView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: `SELECT id, type, message, actor_id, ref_id, read, created_at
          FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    args: [meName, limit],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    type: r.type as string,
    message: r.message as string,
    actorId: (r.actor_id as string) ?? null,
    refId: (r.ref_id as string) ?? null,
    read: Number(r.read) === 1,
    createdAt: Number(r.created_at ?? 0),
  }));
}

export async function getUnreadCount(meName: string): Promise<number> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0",
    args: [meName],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

export async function markNotificationsRead(meName: string): Promise<void> {
  await ensureSocialSchema();
  await client.execute({ sql: "UPDATE notifications SET read = 1 WHERE user_id = ?", args: [meName] });
}

// --- Discord DM outbox -----------------------------------------------------

/**
 * Queue a DM for the bot to deliver. We store the target's Discord **user id**
 * when we know it (so the bot can `fetch_user` reliably regardless of nickname
 * or member-cache state); otherwise we fall back to the player name and let the
 * bot resolve it by display name.
 *
 * `to_id` is explicitly tagged — `id:<discord id>` or `name:<player name>` — so
 * an all-numeric player name can never be mistaken for a Discord id (and vice
 * versa). See cogs/social.py (which also still accepts legacy untagged rows).
 */
export async function enqueueDM(toName: string, message: string): Promise<void> {
  await ensureSocialSchema();
  const discordId = await getDiscordIdForPlayer(toName);
  await client.execute({
    sql: "INSERT INTO discord_dm_outbox (to_id, message, sent, created_at) VALUES (?, ?, 0, ?)",
    args: [discordId ? `id:${discordId}` : `name:${toName}`, message, now()],
  });
}
