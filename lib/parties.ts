/**
 * Turso-backed party store for the HyperLeague website.
 *
 * Parties are ephemeral matchmaking lobbies. They used to live in a JSON file
 * on disk, but that does not work on Vercel (read-only, per-instance
 * filesystem), so a created/joined party vanished on the next poll. They now
 * live in a `web_parties` table in the shared Turso DB alongside everything
 * else, so every serverless instance sees the same state.
 *
 * Each party is stored as a single JSON blob (the members array and all the
 * filter fields), keyed by id, with an `updated_at` epoch-ms column used for
 * TTL pruning and ordering. Parties are auto-disbanded 30 minutes after their
 * last change.
 */

import { randomUUID } from "crypto";
import { client } from "@/lib/db";
import { clearInvitesForParties } from "@/lib/social";

/** 30 minutes of inactivity before a party is auto-disbanded. */
const PARTY_TTL_MS = 30 * 60 * 1000;

export interface PartyMember {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  rank: string;
  elo: number;
  country: string | null;
  /** Equipped profile-card art at join time (absent on older stored parties). */
  card?: string | null;
}

export interface Party {
  id: string;
  name: string;
  game: string;
  gameMode: string;
  matchType: string;
  region: string;
  leaderId: string;
  members: PartyMember[];
  maxSize: number;
  minSkill: string;
  maxSkill: string;
  language: string;
  countries: string;
  verifiedOnly: boolean;
  voiceRequired: boolean;
  /** Invite-only: hidden from the public party list, joinable only via invite. */
  isPrivate: boolean;
  createdAt: number;
  updatedAt: number;
}

let schemaReady: Promise<void> | null = null;

/** Create the table once per process (idempotent). */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = client
      .execute(
        `CREATE TABLE IF NOT EXISTS web_parties (
           id TEXT PRIMARY KEY,
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      )
      .then(() => undefined);
  }
  return schemaReady;
}

/** Read all live parties, pruning any that have expired or emptied. */
export async function getParties(): Promise<Party[]> {
  await ensureSchema();
  const cutoff = Date.now() - PARTY_TTL_MS;
  const rs = await client.execute("SELECT id, data FROM web_parties ORDER BY updated_at DESC");

  const live: Party[] = [];
  const expiredIds: string[] = [];
  for (const row of rs.rows) {
    let party: Party;
    try {
      party = JSON.parse(row.data as string) as Party;
    } catch {
      expiredIds.push(row.id as string);
      continue;
    }
    if (party.members.length > 0 && party.updatedAt >= cutoff) {
      live.push(party);
    } else {
      expiredIds.push(row.id as string);
    }
  }

  if (expiredIds.length > 0) {
    await client.batch(
      expiredIds.map((id) => ({
        sql: "DELETE FROM web_parties WHERE id = ?",
        args: [id],
      }))
    );
    // Tidy up any invites/notifications pointing at the now-dead parties so
    // they can't linger as un-joinable invites. Best-effort: the social tables
    // may not exist yet on a brand-new DB.
    try {
      await clearInvitesForParties(expiredIds);
    } catch {
      /* social schema not ready — nothing to clean */
    }
  }
  return live;
}

export async function getParty(id: string): Promise<Party | undefined> {
  const parties = await getParties();
  return parties.find((p) => p.id === id);
}

/** Find the live party the given user belongs to, if any. */
export async function getPartyForMember(discordId: string): Promise<Party | undefined> {
  const parties = await getParties();
  return parties.find((p) => p.members.some((m) => m.discordId === discordId));
}

/** Persist a single party (insert or update). */
async function upsert(party: Party): Promise<void> {
  await ensureSchema();
  await client.execute({
    sql: `INSERT INTO web_parties (id, data, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    args: [party.id, JSON.stringify(party), party.updatedAt],
  });
}

async function remove(id: string): Promise<void> {
  await client.execute({ sql: "DELETE FROM web_parties WHERE id = ?", args: [id] });
}

export interface CreatePartyInput {
  name: string;
  game?: string;
  gameMode?: string;
  matchType?: string;
  region?: string;
  maxSize?: number;
  minSkill?: string;
  maxSkill?: string;
  language?: string;
  countries?: string;
  verifiedOnly?: boolean;
  voiceRequired?: boolean;
  isPrivate?: boolean;
  leader: PartyMember;
}

export async function createParty(input: CreatePartyInput): Promise<Party> {
  const parties = await getParties();

  // A user can only lead / belong to one party at a time — remove them elsewhere.
  for (const p of parties) {
    if (!p.members.some((m) => m.discordId === input.leader.discordId)) continue;
    const members = p.members.filter((m) => m.discordId !== input.leader.discordId);
    if (members.length === 0 || p.leaderId === input.leader.discordId) {
      await remove(p.id);
    } else {
      await upsert({ ...p, members, updatedAt: Date.now() });
    }
  }

  const now = Date.now();
  const party: Party = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim().slice(0, 40) || "New Party",
    game: input.game || "Blox Strike",
    gameMode: input.gameMode || "5v5",
    matchType: input.matchType || "Standard",
    region: input.region || "EU",
    leaderId: input.leader.discordId,
    members: [input.leader],
    maxSize: input.maxSize || 5,
    minSkill: input.minSkill || "D",
    maxSkill: input.maxSkill || "STAR",
    language: input.language || "Any",
    countries: input.countries || "Any",
    verifiedOnly: !!input.verifiedOnly,
    voiceRequired: !!input.voiceRequired,
    isPrivate: !!input.isPrivate,
    createdAt: now,
    updatedAt: now,
  };

  await upsert(party);
  return party;
}

/** Remove a member from every party except `exceptId` (best-effort cleanup). */
async function removeMemberFromOtherParties(discordId: string, exceptId: string): Promise<void> {
  const parties = await getParties();
  for (const p of parties) {
    if (p.id === exceptId) continue;
    if (!p.members.some((m) => m.discordId === discordId)) continue;
    const members = p.members.filter((m) => m.discordId !== discordId);
    if (members.length === 0) {
      await remove(p.id);
    } else {
      const leaderId = p.leaderId === discordId ? members[0].discordId : p.leaderId;
      await upsert({ ...p, members, leaderId, updatedAt: Date.now() });
    }
  }
}

/**
 * Join a party under optimistic concurrency. On Vercel each request is a
 * separate serverless instance with no shared lock, so a naive read-all →
 * modify → write-back loses updates when two people join at once (both read the
 * same members list, both write their own +1, last write wins). We instead read
 * just this party's row with its `updated_at` token and commit with
 * `WHERE updated_at = <token>`; if someone else changed the row first the update
 * affects 0 rows and we re-read and retry.
 */
export async function joinParty(
  id: string,
  member: PartyMember
): Promise<Party | { error: string }> {
  await ensureSchema();
  const cutoff = Date.now() - PARTY_TTL_MS;
  for (let attempt = 0; attempt < 6; attempt++) {
    const rs = await client.execute({
      sql: "SELECT data, updated_at FROM web_parties WHERE id = ?",
      args: [id],
    });
    if (rs.rows.length === 0) return { error: "Party not found or expired" };
    let party: Party;
    try {
      party = JSON.parse(rs.rows[0].data as string) as Party;
    } catch {
      return { error: "Party not found or expired" };
    }
    const prevToken = Number(rs.rows[0].updated_at);
    if (party.members.length === 0 || party.updatedAt < cutoff) {
      return { error: "Party not found or expired" };
    }
    if (party.members.some((m) => m.discordId === member.discordId)) return party;
    if (party.members.length >= party.maxSize) return { error: "Party is full" };

    party.members.push(member);
    // Strictly-increasing token so the compare-and-set below can never collide
    // with the value we just read.
    party.updatedAt = Math.max(Date.now(), prevToken + 1);
    const upd = await client.execute({
      sql: "UPDATE web_parties SET data = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
      args: [JSON.stringify(party), party.updatedAt, id, prevToken],
    });
    if (upd.rowsAffected > 0) {
      // Committed; now drop this member from any other party they were in.
      await removeMemberFromOtherParties(member.discordId, id);
      return party;
    }
    // Lost the race — another writer touched the row. Re-read and retry.
  }
  return { error: "Party is busy — please try again." };
}

export async function leaveParty(id: string, discordId: string): Promise<Party[]> {
  await ensureSchema();
  for (let attempt = 0; attempt < 6; attempt++) {
    const rs = await client.execute({
      sql: "SELECT data, updated_at FROM web_parties WHERE id = ?",
      args: [id],
    });
    if (rs.rows.length === 0) return getParties();
    let party: Party;
    try {
      party = JSON.parse(rs.rows[0].data as string) as Party;
    } catch {
      return getParties();
    }
    const prevToken = Number(rs.rows[0].updated_at);
    if (!party.members.some((m) => m.discordId === discordId)) return getParties();

    party.members = party.members.filter((m) => m.discordId !== discordId);

    if (party.members.length === 0) {
      // Guard the delete on the token so we don't drop a party someone just
      // joined between our read and write.
      const del = await client.execute({
        sql: "DELETE FROM web_parties WHERE id = ? AND updated_at = ?",
        args: [id, prevToken],
      });
      if (del.rowsAffected > 0) {
        try {
          await clearInvitesForParties([id]);
        } catch {
          /* social schema not ready */
        }
        return getParties();
      }
    } else {
      if (party.leaderId === discordId) party.leaderId = party.members[0].discordId;
      party.updatedAt = Math.max(Date.now(), prevToken + 1);
      const upd = await client.execute({
        sql: "UPDATE web_parties SET data = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
        args: [JSON.stringify(party), party.updatedAt, id, prevToken],
      });
      if (upd.rowsAffected > 0) return getParties();
    }
    // Lost the race — re-read and retry.
  }
  return getParties();
}
