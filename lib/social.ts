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
 * The tables (created in core/schema.py and lazily here) store player names in
 * player_a / from_player / player_name columns.
 */

import { client, mapRank } from "@/lib/db";
import { pickAvatar } from "@/lib/avatar";
import { schemaOnce } from "@/lib/schema-once";

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
    schemaReady = schemaOnce("social", async () => {
      await client.batch([
        // Maps a player name -> their Discord id, captured whenever the website
        // knows both (login/queue/party). Lets the bot DM by user id instead of
        // guessing a member by display name.
        `CREATE TABLE IF NOT EXISTS web_users (
           discord_id TEXT PRIMARY KEY, player_name TEXT, username TEXT,
           updated_at INTEGER )`,
        `CREATE TABLE IF NOT EXISTS friendships (
           player_a TEXT NOT NULL, player_b TEXT NOT NULL, created_at INTEGER,
           PRIMARY KEY (player_a, player_b) )`,
        `CREATE TABLE IF NOT EXISTS friend_requests (
           from_player TEXT NOT NULL, to_player TEXT NOT NULL, created_at INTEGER,
           PRIMARY KEY (from_player, to_player) )`,
        `CREATE TABLE IF NOT EXISTS party_invites (
           party_id TEXT NOT NULL, from_player TEXT NOT NULL, to_player TEXT NOT NULL,
           created_at INTEGER, PRIMARY KEY (party_id, to_player) )`,
        `CREATE TABLE IF NOT EXISTS notifications (
           id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT NOT NULL,
           type TEXT NOT NULL, message TEXT NOT NULL, actor_name TEXT, ref_id TEXT,
           read INTEGER NOT NULL DEFAULT 0, created_at INTEGER )`,
        `CREATE TABLE IF NOT EXISTS discord_dm_outbox (
           id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, player_name TEXT,
           message TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER )`,
      ]);
      // player_id columns (Phase 1 of the players(name) -> players(id) FK
      // migration; see docs/DATABASE_PK_FK_RELATIONSHIPS.docx). This mirrors
      // core/schema.py's own ALTER-guarded back-fill so a database this
      // standalone fallback created doesn't crash the id-aware queries below.
      const idColumns = [
        "ALTER TABLE web_users ADD COLUMN player_id INTEGER",
        "ALTER TABLE friendships ADD COLUMN player_a_id INTEGER",
        "ALTER TABLE friendships ADD COLUMN player_b_id INTEGER",
        "ALTER TABLE friend_requests ADD COLUMN from_player_id INTEGER",
        "ALTER TABLE friend_requests ADD COLUMN to_player_id INTEGER",
        "ALTER TABLE party_invites ADD COLUMN from_player_id INTEGER",
        "ALTER TABLE party_invites ADD COLUMN to_player_id INTEGER",
        "ALTER TABLE notifications ADD COLUMN player_id INTEGER",
        "ALTER TABLE notifications ADD COLUMN actor_player_id INTEGER",
        "ALTER TABLE discord_dm_outbox ADD COLUMN player_id INTEGER",
      ];
      for (const sql of idColumns) {
        await client.execute(sql).catch(() => undefined);
      }
      const indexes = [
        "CREATE INDEX IF NOT EXISTS idx_web_users_player ON web_users(player_name)",
        "CREATE INDEX IF NOT EXISTS idx_friendships_player_b ON friendships(player_b)",
        "CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_player)",
        "CREATE INDEX IF NOT EXISTS idx_party_invites_to ON party_invites(to_player)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_player ON notifications(player_name, read)",
        "CREATE INDEX IF NOT EXISTS idx_dm_outbox_sent ON discord_dm_outbox(sent)",
        "CREATE INDEX IF NOT EXISTS idx_web_users_player_id ON web_users(player_id)",
        "CREATE INDEX IF NOT EXISTS idx_friendships_player_b_id ON friendships(player_b_id)",
        "CREATE INDEX IF NOT EXISTS idx_friend_requests_to_id ON friend_requests(to_player_id)",
        "CREATE INDEX IF NOT EXISTS idx_party_invites_to_id ON party_invites(to_player_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_player_id ON notifications(player_id, read)",
      ];
      for (const sql of indexes) {
        await client.execute(sql).catch(() => undefined);
      }
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
  // player_id is dual-written alongside player_name — see
  // docs/DATABASE_PK_FK_RELATIONSHIPS.docx. Resolved via a subquery rather
  // than a separate lookup; NULL if playerName doesn't match a player.
  await client.execute({
    sql: `INSERT INTO web_users (discord_id, player_name, player_id, username, updated_at)
          VALUES (?, ?, (SELECT id FROM players WHERE name = ?), ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            player_name = excluded.player_name,
            player_id = excluded.player_id,
            username = excluded.username,
            updated_at = excluded.updated_at`,
    args: [discordId, playerName, playerName, username, now()],
  });
}

/** Look up a known Discord id for a player name, if we've ever seen them. */
export async function getDiscordIdForPlayer(name: string): Promise<string | null> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: `SELECT discord_id FROM web_users
          WHERE player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?
          ORDER BY updated_at DESC LIMIT 1`,
    args: [name, name],
  });
  return (rs.rows[0]?.discord_id as string) ?? null;
}

// --- player directory (from the real players table) ------------------------

function rowToFriend(r: Record<string, unknown>): Friend {
  const placing = Number(r.placement_done) !== 1;
  return {
    name: r.name as string,
    rank: placing ? "UNRANKED" : mapRank((r.rank as string) || ""),
    avatar: pickAvatar(
      r.roblox_avatar_image as string | null,
      r.discord_avatar as string | null,
      r.discord_id as string | number | null
    ) || null,
    country: (r.country as string) ?? null,
    discordUsername: (r.discord_username as string) ?? null,
  };
}

async function resolvePlayers(names: string[]): Promise<Map<string, Friend>> {
  const map = new Map<string, Friend>();
  if (names.length === 0) return map;
  const placeholders = names.map(() => "?").join(",");
  const rs = await client.execute({
    sql: `SELECT name, rank, placement_done, roblox_avatar_image, country, discord_username, discord_avatar,
                 discord_id FROM players WHERE name IN (${placeholders})`,
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
    sql: `SELECT name, rank, placement_done, roblox_avatar_image, country, discord_username, discord_avatar,
                 discord_id FROM players
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
    sql: "SELECT 1 FROM friendships WHERE player_a = ? AND player_b = ?",
    args: [x, y],
  });
  return rs.rows.length > 0;
}

export async function getFriends(name: string): Promise<Friend[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT player_a, player_b FROM friendships WHERE player_a = ? OR player_b = ?",
    args: [name, name],
  });
  const names = rs.rows.map((r) =>
    (r.player_a as string) === name ? (r.player_b as string) : (r.player_a as string)
  );
  const players = await resolvePlayers(names);
  return names.map((n) => players.get(n)!);
}

async function requestExists(from: string, to: string): Promise<boolean> {
  const rs = await client.execute({
    sql: "SELECT 1 FROM friend_requests WHERE from_player = ? AND to_player = ?",
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
    sql: `INSERT INTO friend_requests (from_player, to_player, from_player_id, to_player_id, created_at)
          VALUES (?, ?, (SELECT id FROM players WHERE name = ?), (SELECT id FROM players WHERE name = ?), ?)`,
    args: [fromName, toName, fromName, toName, now()],
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
    { sql: "DELETE FROM friend_requests WHERE from_player = ? AND to_player = ?", args: [fromName, meName] },
    { sql: "DELETE FROM friend_requests WHERE from_player = ? AND to_player = ?", args: [meName, fromName] },
    {
      sql: `DELETE FROM notifications
            WHERE (player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?)
              AND type = 'friend_request'
              AND (actor_player_id = (SELECT id FROM players WHERE name = ?) OR actor_name = ?)`,
      args: [meName, meName, fromName, fromName],
    },
  ]);
  // Only actually befriend + notify when there was a real request to accept —
  // otherwise POST /api/friends/accept could conjure a friendship (and a DM to
  // the target) with no handshake.
  if (!pending) return;
  const [x, y] = pair(meName, fromName);
  // player_a_id/player_b_id dual-written alongside the names — see
  // docs/DATABASE_PK_FK_RELATIONSHIPS.docx. The pair's (player_a, player_b)
  // ordering stays the real primary key untouched, same reasoning as
  // core/schema.py's Phase 1 for this table.
  await client.execute({
    sql: `INSERT OR IGNORE INTO friendships (player_a, player_b, player_a_id, player_b_id, created_at)
          VALUES (?, ?, (SELECT id FROM players WHERE name = ?), (SELECT id FROM players WHERE name = ?), ?)`,
    args: [x, y, x, y, now()],
  });
  await addNotification(fromName, "friend_accepted", `${meName} accepted your friend request.`, meName);
  await enqueueDM(fromName, `✅ **${meName}** accepted your friend request on HyperLeague.`);
}

export async function rejectFriendRequest(meName: string, fromName: string): Promise<void> {
  await ensureSocialSchema();
  await client.batch([
    { sql: "DELETE FROM friend_requests WHERE from_player = ? AND to_player = ?", args: [fromName, meName] },
    {
      sql: `DELETE FROM notifications
            WHERE (player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?)
              AND type = 'friend_request'
              AND (actor_player_id = (SELECT id FROM players WHERE name = ?) OR actor_name = ?)`,
      args: [meName, meName, fromName, fromName],
    },
  ]);
}

export async function removeFriend(meName: string, otherName: string): Promise<void> {
  await ensureSocialSchema();
  const [x, y] = pair(meName, otherName);
  await client.execute({
    sql: "DELETE FROM friendships WHERE player_a = ? AND player_b = ?",
    args: [x, y],
  });
}

export async function getIncomingRequestCount(meName: string): Promise<number> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM friend_requests WHERE to_player = ?",
    args: [meName],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

export async function getIncomingRequests(meName: string): Promise<FriendRequestView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT from_player, created_at FROM friend_requests WHERE to_player = ? ORDER BY created_at DESC",
    args: [meName],
  });
  const names = rs.rows.map((r) => r.from_player as string);
  const players = await resolvePlayers(names);
  return rs.rows.map((r) => ({
    name: r.from_player as string,
    friend: players.get(r.from_player as string)!,
    createdAt: Number(r.created_at ?? 0),
  }));
}

export async function getOutgoingRequests(meName: string): Promise<FriendRequestView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT to_player, created_at FROM friend_requests WHERE from_player = ? ORDER BY created_at DESC",
    args: [meName],
  });
  const names = rs.rows.map((r) => r.to_player as string);
  const players = await resolvePlayers(names);
  return rs.rows.map((r) => ({
    name: r.to_player as string,
    friend: players.get(r.to_player as string)!,
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
    sql: `INSERT INTO party_invites (party_id, from_player, to_player, from_player_id, to_player_id, created_at)
          VALUES (?, ?, ?, (SELECT id FROM players WHERE name = ?), (SELECT id FROM players WHERE name = ?), ?)`,
    args: [partyId, fromName, toName, fromName, toName, now()],
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
    sql: `SELECT party_id, to_player FROM party_invites WHERE party_id IN (${placeholders})`,
    args: partyIds,
  });
  for (const r of rs.rows) {
    const pid = r.party_id as string;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(r.to_player as string);
  }
  return map;
}

export async function hasPartyInvite(partyId: string, toName: string): Promise<boolean> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: "SELECT 1 FROM party_invites WHERE party_id = ? AND to_player = ?",
    args: [partyId, toName],
  });
  return rs.rows.length > 0;
}

export async function clearPartyInvite(partyId: string, toName: string): Promise<void> {
  await ensureSocialSchema();
  await client.batch([
    { sql: "DELETE FROM party_invites WHERE party_id = ? AND to_player = ?", args: [partyId, toName] },
    {
      sql: `DELETE FROM notifications
            WHERE (player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?)
              AND type = 'party_invite' AND ref_id = ?`,
      args: [toName, toName, partyId],
    },
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
    sql: "SELECT party_id FROM party_invites WHERE to_player = ?",
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
  // player_id/actor_player_id dual-written — see
  // docs/DATABASE_PK_FK_RELATIONSHIPS.docx. actorName is nullable, so its
  // subquery naturally resolves to NULL when there's no actor.
  await client.execute({
    sql: `INSERT INTO notifications
              (player_name, player_id, type, message, actor_name, actor_player_id, ref_id, read, created_at)
          VALUES (?, (SELECT id FROM players WHERE name = ?), ?, ?, ?,
                  (SELECT id FROM players WHERE name = ?), ?, 0, ?)`,
    args: [userName, userName, type, message, actorName, actorName, refId, now()],
  });
}

export async function getNotifications(meName: string, limit = 30): Promise<NotificationView[]> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: `SELECT id, type, message, actor_name, ref_id, read, created_at
          FROM notifications
          WHERE player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?
          ORDER BY created_at DESC LIMIT ?`,
    args: [meName, meName, limit],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    type: r.type as string,
    message: r.message as string,
    actorId: (r.actor_name as string) ?? null,
    refId: (r.ref_id as string) ?? null,
    read: Number(r.read) === 1,
    createdAt: Number(r.created_at ?? 0),
  }));
}

export async function getUnreadCount(meName: string): Promise<number> {
  await ensureSocialSchema();
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM notifications
          WHERE (player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?) AND read = 0`,
    args: [meName, meName],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

export async function markNotificationsRead(meName: string): Promise<void> {
  await ensureSocialSchema();
  await client.execute({
    sql: `UPDATE notifications SET read = 1
          WHERE player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?`,
    args: [meName, meName],
  });
}

// --- Discord DM outbox -----------------------------------------------------

/**
 * Queue a DM for the bot to deliver. We store the target's Discord **user id**
 * when we know it (so the bot can `fetch_user` reliably regardless of nickname
 * or member-cache state); otherwise we fall back to the player name and let the
 * bot resolve it by display name.
 */
export async function enqueueDM(toName: string, message: string): Promise<void> {
  await ensureSocialSchema();
  const discordId = await getDiscordIdForPlayer(toName);
  await client.execute({
    sql: `INSERT INTO discord_dm_outbox (discord_id, player_name, player_id, message, sent, created_at)
          VALUES (?, ?, (SELECT id FROM players WHERE name = ?), ?, 0, ?)`,
    args: [discordId, toName, toName, message, now()],
  });
}
