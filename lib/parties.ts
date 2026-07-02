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
    createdAt: now,
    updatedAt: now,
  };

  await upsert(party);
  return party;
}

export async function joinParty(
  id: string,
  member: PartyMember
): Promise<Party | { error: string }> {
  const parties = await getParties();
  const party = parties.find((p) => p.id === id);
  if (!party) return { error: "Party not found or expired" };
  if (party.members.some((m) => m.discordId === member.discordId)) return party;
  if (party.members.length >= party.maxSize) return { error: "Party is full" };

  // Remove the joining member from any other party first.
  for (const p of parties) {
    if (p.id === id) continue;
    if (!p.members.some((m) => m.discordId === member.discordId)) continue;
    const members = p.members.filter((m) => m.discordId !== member.discordId);
    if (members.length === 0) {
      await remove(p.id);
    } else {
      const leaderId = p.leaderId === member.discordId ? members[0].discordId : p.leaderId;
      await upsert({ ...p, members, leaderId, updatedAt: Date.now() });
    }
  }

  party.members.push(member);
  party.updatedAt = Date.now();
  await upsert(party);
  return party;
}

export async function leaveParty(id: string, discordId: string): Promise<Party[]> {
  const parties = await getParties();
  const party = parties.find((p) => p.id === id);
  if (!party) return parties;

  party.members = party.members.filter((m) => m.discordId !== discordId);
  party.updatedAt = Date.now();

  // If the leader left, promote the next member; if empty, drop the party.
  if (party.members.length === 0) {
    await remove(party.id);
  } else {
    if (party.leaderId === discordId) party.leaderId = party.members[0].discordId;
    await upsert(party);
  }
  return getParties();
}
