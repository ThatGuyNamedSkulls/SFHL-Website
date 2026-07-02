/**
 * Social layer for HyperLeague: a Discord-user directory, friends + friend
 * requests, party invites, website notifications, and a Discord-DM outbox the
 * bot drains.
 *
 * Everything is keyed on Discord user id (stable and DM-able). Usernames /
 * avatars are snapshotted into `web_users` on login for display and search.
 * All state lives in the shared Turso DB so the bot sees the same rows.
 */

import { client } from "@/lib/db";

export interface WebUser {
  discord_id: string;
  username: string | null;
  avatar: string | null;
  player_name: string | null;
}

export interface FriendRequestView {
  id: string; // the other user's discord id (requests are keyed by pair)
  user: WebUser;
  createdAt: number;
}

export interface NotificationView {
  id: number;
  type: string;
  message: string;
  actorId: string | null;
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
        `CREATE TABLE IF NOT EXISTS web_users (
           discord_id TEXT PRIMARY KEY, username TEXT, avatar TEXT,
           player_name TEXT, updated_at INTEGER )`,
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

// --- users -----------------------------------------------------------------

export async function upsertWebUser(u: WebUser): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: `INSERT INTO web_users (discord_id, username, avatar, player_name, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            username = excluded.username,
            avatar = excluded.avatar,
            player_name = excluded.player_name,
            updated_at = excluded.updated_at`,
    args: [u.discord_id, u.username, u.avatar, u.player_name, now()],
  });
}

export async function getUser(discordId: string): Promise<WebUser | null> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT discord_id, username, avatar, player_name FROM web_users WHERE discord_id = ?",
    args: [discordId],
  });
  return (rs.rows[0] as unknown as WebUser) ?? null;
}

async function getUsers(ids: string[]): Promise<Map<string, WebUser>> {
  const map = new Map<string, WebUser>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rs = await client.execute({
    sql: `SELECT discord_id, username, avatar, player_name FROM web_users WHERE discord_id IN (${placeholders})`,
    args: ids,
  });
  for (const row of rs.rows as unknown as WebUser[]) map.set(row.discord_id, row);
  // Fill any unknown ids so callers always get something to render.
  for (const id of ids) {
    if (!map.has(id)) map.set(id, { discord_id: id, username: null, avatar: null, player_name: null });
  }
  return map;
}

/** Search the user directory by username or linked player name (excludes self). */
export async function searchUsers(query: string, selfId: string): Promise<WebUser[]> {
  await ensureSocialSchema();
  const q = `%${query.trim()}%`;
  const rs = await client.execute({
    sql: `SELECT discord_id, username, avatar, player_name FROM web_users
          WHERE discord_id != ? AND (username LIKE ? OR player_name LIKE ?)
          ORDER BY username LIMIT 20`,
    args: [selfId, q, q],
  });
  return rs.rows as unknown as WebUser[];
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

export async function getFriends(discordId: string): Promise<WebUser[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: `SELECT user_a, user_b FROM friendships WHERE user_a = ? OR user_b = ?`,
    args: [discordId, discordId],
  });
  const ids = rs.rows.map((r) =>
    (r.user_a as string) === discordId ? (r.user_b as string) : (r.user_a as string)
  );
  const users = await getUsers(ids);
  return ids.map((id) => users.get(id)!);
}

async function requestExists(from: string, to: string): Promise<boolean> {
  const rs = await client.execute({
    sql: "SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?",
    args: [from, to],
  });
  return rs.rows.length > 0;
}

/**
 * Send a friend request. If the target already invited the sender, the two
 * become friends immediately. Returns a short status the route can surface.
 */
export async function sendFriendRequest(
  from: WebUser,
  toId: string
): Promise<"sent" | "friends" | "exists" | "self"> {
  await ensureSocialSchema();
  if (from.discord_id === toId) return "self";
  if (await areFriends(from.discord_id, toId)) return "friends";

  // Reverse request pending → mutual accept.
  if (await requestExists(toId, from.discord_id)) {
    await acceptFriendRequest(from.discord_id, toId);
    return "friends";
  }
  if (await requestExists(from.discord_id, toId)) return "exists";

  await client.execute({
    sql: "INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)",
    args: [from.discord_id, toId, now()],
  });
  const name = from.player_name || from.username || "Someone";
  await addNotification(toId, "friend_request", `${name} sent you a friend request.`, from.discord_id);
  await enqueueDM(
    toId,
    `👋 **${name}** sent you a friend request on HyperLeague. Accept it here: https://sf-hl.com/friends`
  );
  return "sent";
}

/** Accept the request `fromId -> meId` (creates the friendship, clears requests). */
export async function acceptFriendRequest(meId: string, fromId: string): Promise<void> {
  await ensureSocialSchema();
  const [x, y] = pair(meId, fromId);
  await client.batch([
    { sql: "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)", args: [x, y, now()] },
    { sql: "DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?", args: [fromId, meId] },
    { sql: "DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?", args: [meId, fromId] },
  ]);
  const me = await getUser(meId);
  const name = me?.player_name || me?.username || "Someone";
  await addNotification(fromId, "friend_accepted", `${name} accepted your friend request.`, meId);
  await enqueueDM(fromId, `✅ **${name}** accepted your friend request on HyperLeague.`);
}

export async function rejectFriendRequest(meId: string, fromId: string): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: "DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?",
    args: [fromId, meId],
  });
}

export async function removeFriend(meId: string, otherId: string): Promise<void> {
  await ensureSocialSchema();
  const [x, y] = pair(meId, otherId);
  await client.execute({
    sql: "DELETE FROM friendships WHERE user_a = ? AND user_b = ?",
    args: [x, y],
  });
}

export async function getIncomingRequests(meId: string): Promise<FriendRequestView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT from_id, created_at FROM friend_requests WHERE to_id = ? ORDER BY created_at DESC",
    args: [meId],
  });
  const ids = rs.rows.map((r) => r.from_id as string);
  const users = await getUsers(ids);
  return rs.rows.map((r) => ({
    id: r.from_id as string,
    user: users.get(r.from_id as string)!,
    createdAt: Number(r.created_at ?? 0),
  }));
}

export async function getOutgoingRequests(meId: string): Promise<FriendRequestView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT to_id, created_at FROM friend_requests WHERE from_id = ? ORDER BY created_at DESC",
    args: [meId],
  });
  const ids = rs.rows.map((r) => r.to_id as string);
  const users = await getUsers(ids);
  return rs.rows.map((r) => ({
    id: r.to_id as string,
    user: users.get(r.to_id as string)!,
    createdAt: Number(r.created_at ?? 0),
  }));
}

// --- party invites ---------------------------------------------------------

/** Record a party invite + notify/DM the target. */
export async function createPartyInvite(
  partyId: string,
  from: WebUser,
  toId: string,
  partyName: string
): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: `INSERT INTO party_invites (party_id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(party_id, to_id) DO UPDATE SET from_id = excluded.from_id, created_at = excluded.created_at`,
    args: [partyId, from.discord_id, toId, now()],
  });
  const name = from.player_name || from.username || "Someone";
  await addNotification(
    toId,
    "party_invite",
    `${name} invited you to the party "${partyName}".`,
    from.discord_id,
    partyId
  );
  await enqueueDM(
    toId,
    `🎉 **${name}** invited you to their party "${partyName}" on HyperLeague. Join here: https://sf-hl.com/party-finder`
  );
}

export async function hasPartyInvite(partyId: string, toId: string): Promise<boolean> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT 1 FROM party_invites WHERE party_id = ? AND to_id = ?",
    args: [partyId, toId],
  });
  return rs.rows.length > 0;
}

export async function clearPartyInvite(partyId: string, toId: string): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: "DELETE FROM party_invites WHERE party_id = ? AND to_id = ?",
    args: [partyId, toId],
  });
}

export async function getPartyInvitesFor(meId: string): Promise<{ partyId: string; from: WebUser }[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT party_id, from_id FROM party_invites WHERE to_id = ? ORDER BY created_at DESC",
    args: [meId],
  });
  const ids = rs.rows.map((r) => r.from_id as string);
  const users = await getUsers(ids);
  return rs.rows.map((r) => ({
    partyId: r.party_id as string,
    from: users.get(r.from_id as string)!,
  }));
}

// --- notifications ---------------------------------------------------------

export async function addNotification(
  userId: string,
  type: string,
  message: string,
  actorId: string | null = null,
  refId: string | null = null
): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: `INSERT INTO notifications (user_id, type, message, actor_id, ref_id, read, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)`,
    args: [userId, type, message, actorId, refId, now()],
  });
}

export async function getNotifications(meId: string, limit = 30): Promise<NotificationView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: `SELECT id, type, message, actor_id, ref_id, read, created_at
          FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    args: [meId, limit],
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

export async function getUnreadCount(meId: string): Promise<number> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0",
    args: [meId],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

export async function markNotificationsRead(meId: string): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: "UPDATE notifications SET read = 1 WHERE user_id = ?",
    args: [meId],
  });
}

// --- Discord DM outbox -----------------------------------------------------

/** Queue a DM for the bot to deliver (see cogs/social.py). */
export async function enqueueDM(toId: string, message: string): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: "INSERT INTO discord_dm_outbox (to_id, message, sent, created_at) VALUES (?, ?, 0, ?)",
    args: [toId, message, now()],
  });
}
