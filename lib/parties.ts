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
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { partyMaxForMatchType } from "@/lib/queue-modes";
import {
  createPartyVoiceChannel,
  deletePartyVoiceChannel,
  promptJoinPartyVoice,
  syncPartyVoiceMembers,
  partyVoiceAppUrl,
} from "@/lib/discord-party-voice";
import { schemaOnce } from "@/lib/schema-once";

/** 30 minutes without any party operation (create/join/leave) before a party
 *  is auto-disbanded. */
const PARTY_TTL_MS = 30 * 60 * 1000;

export interface PartyMember {
  discordId: string;
  username: string;
  playerName: string | null;
  /** Discord @handle for "name (@handle)" display (absent on old snapshots). */
  discordUsername?: string | null;
  avatar: string | null;
  rank: string;
  elo: number;
  country: string | null;
  /** Equipped profile-card art at join time. Display paths re-resolve this at
   *  read time (withFreshCosmetics), so the snapshot is only a fallback. */
  card?: string | null;
  /** Equipped avatar-frame art at join time (same read-time refresh applies). */
  frame?: string | null;
  /** Live guild-membership check, attached at read time (withMemberStatus). */
  verified?: boolean | null;
  /** Whether this member currently meets queue requirements (read time). */
  canQueue?: boolean;
  /** Get Matchmaking Access Discord role (read time). */
  mmAccess?: boolean | null;
  /** Club tag shown in front of the username. */
  clubTag?: string | null;
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
  /** Vibe tag (Chill / Fun / Balanced / Serious / Intense). */
  vibe?: string;
  createdAt: number;
  updatedAt: number;
  /** Private Discord party voice (created on party create). */
  voiceChannelId?: string | null;
  voiceChannelUrl?: string | null;
  guildId?: string | null;
}

let schemaReady: Promise<void> | null = null;

/** Create the table once per process (idempotent). */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = schemaOnce("parties", async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_parties (
           id TEXT PRIMARY KEY,
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      );
      await client
        .execute("CREATE INDEX IF NOT EXISTS idx_web_parties_updated ON web_parties (updated_at)")
        .catch(() => undefined);
    })();
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
  const expiredMembers: PartyMember[] = [];
  const expiredVoiceIds: string[] = [];
  for (const row of rs.rows) {
    let party: Party;
    try {
      party = JSON.parse(row.data as string) as Party;
    } catch {
      expiredIds.push(row.id as string);
      continue;
    }
    if (party.members.length > 0 && party.updatedAt >= cutoff) {
      const appUrl = partyVoiceAppUrl(party.voiceChannelId, party.guildId);
      live.push(appUrl ? { ...party, voiceChannelUrl: appUrl } : party);
    } else {
      expiredIds.push(row.id as string);
      expiredMembers.push(...party.members);
      if (party.voiceChannelId) expiredVoiceIds.push(party.voiceChannelId);
    }
  }

  if (expiredIds.length > 0) {
    // A disbanded party's members must not linger in the matchmaking queue.
    await dequeueMembers(expiredMembers);
    await client.batch(
      expiredIds.map((id) => ({
        sql: "DELETE FROM web_parties WHERE id = ?",
        args: [id],
      }))
    );
    for (const vid of expiredVoiceIds) {
      try {
        await deletePartyVoiceChannel(vid);
      } catch {
        /* Discord may already have dropped the channel */
      }
    }
    // Tidy up any invites/notifications pointing at the now-dead parties so
    // they can't linger as un-joinable invites. Best-effort: the social tables
    // may not exist yet on a brand-new DB.
    try {
      await clearInvitesForParties(expiredIds);
    } catch {
      /* social schema not ready â€” nothing to clean */
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

/** Best-effort: pull these members out of the web queue. Any roster change
 *  (leave/disband/expiry) invalidates the party's queue entry, so the whole
 *  party is dequeued together. */
async function dequeueMembers(members: PartyMember[]): Promise<void> {
  if (members.length === 0) return;
  try {
    await client.batch(
      members.map((m) => ({
        sql: "DELETE FROM web_queue WHERE discord_id = ?",
        args: [m.discordId],
      }))
    );
  } catch {
    /* web_queue table may not exist yet */
  }
}

export interface CreatePartyInput {
  name?: string;
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
  vibe?: string;
  leader: PartyMember;
}

export async function createParty(input: CreatePartyInput): Promise<Party> {
  const parties = await getParties();

  // A user can only lead / belong to one party at a time — remove them elsewhere.
  for (const p of parties) {
    if (!p.members.some((m) => m.discordId === input.leader.discordId)) continue;
    // Leaving invalidates the old party's queue entry for everyone in it.
    await dequeueMembers(p.members);
    const members = p.members.filter((m) => m.discordId !== input.leader.discordId);
    if (members.length === 0 || p.leaderId === input.leader.discordId) {
      try {
        await deletePartyVoiceChannel(p.voiceChannelId);
      } catch {
        /* ignore */
      }
      await remove(p.id);
    } else {
      await upsert({ ...p, members, updatedAt: Date.now() });
      if (p.voiceChannelId) {
        try {
          await syncPartyVoiceMembers(
            p.voiceChannelId,
            members.map((m) => m.discordId),
            p.members.map((m) => m.discordId)
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  const now = Date.now();
  let party: Party = {
    id: randomUUID().slice(0, 8),
    name: (input.name ?? "").trim().slice(0, 40) || "New Party",
    game: input.game || "Strike Force",
    gameMode: input.gameMode || MATCH_MODE_LABEL,
    matchType: input.matchType || "Standard",
    region: input.region || "EU",
    leaderId: input.leader.discordId,
    members: [input.leader],
    maxSize: partyMaxForMatchType(input.matchType),
    minSkill: input.minSkill || "D",
    maxSkill: input.maxSkill || "STAR",
    language: input.language || "Any",
    countries: input.countries || "Any",
    verifiedOnly: !!input.verifiedOnly,
    voiceRequired: !!input.voiceRequired,
    isPrivate: !!input.isPrivate,
    vibe: input.vibe || "Balanced",
    createdAt: now,
    updatedAt: now,
    voiceChannelId: null,
    voiceChannelUrl: null,
    guildId: null,
  };

  await upsert(party);
  try {
    const voice = await createPartyVoiceChannel(
      party.id,
      input.leader.username || input.leader.playerName || "hl",
      [input.leader.discordId]
    );
    if (voice) {
      party = { ...party, ...voice, updatedAt: Date.now() };
      await upsert(party);
      await promptJoinPartyVoice(input.leader.playerName, voice);
    }
  } catch (err) {
    console.error("Failed to create party voice channel", err);
  }
  return party;
}

/** Remove a member from every party except `exceptId` (best-effort cleanup). */
async function removeMemberFromOtherParties(discordId: string, exceptId: string): Promise<void> {
  const parties = await getParties();
  for (const p of parties) {
    if (p.id === exceptId) continue;
    if (!p.members.some((m) => m.discordId === discordId)) continue;
    // Leaving invalidates the old party's queue entry for everyone in it.
    await dequeueMembers(p.members);
    const members = p.members.filter((m) => m.discordId !== discordId);
    if (members.length === 0) {
      try {
        await deletePartyVoiceChannel(p.voiceChannelId);
      } catch {
        /* ignore */
      }
      await remove(p.id);
    } else {
      const leaderId = p.leaderId === discordId ? members[0].discordId : p.leaderId;
      await upsert({ ...p, members, leaderId, updatedAt: Date.now() });
      if (p.voiceChannelId) {
        try {
          await syncPartyVoiceMembers(
            p.voiceChannelId,
            members.map((m) => m.discordId),
            p.members.map((m) => m.discordId)
          );
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/**
 * Join a party under optimistic concurrency. On Vercel each request is a
 * separate serverless instance with no shared lock, so a naive read-all â†’
 * modify â†’ write-back loses updates when two people join at once (both read the
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

    const previousIds = party.members.map((m) => m.discordId);
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
      try {
        if (!party.voiceChannelId) {
          const leader =
            party.members.find((m) => m.discordId === party.leaderId) ?? party.members[0];
          const voice = await createPartyVoiceChannel(
            party.id,
            leader?.username || leader?.playerName || "hl",
            party.members.map((m) => m.discordId)
          );
          if (voice) {
            party = { ...party, ...voice };
            await upsert(party);
            for (const m of party.members) {
              await promptJoinPartyVoice(m.playerName, voice);
            }
          }
        } else {
          await syncPartyVoiceMembers(
            party.voiceChannelId,
            party.members.map((m) => m.discordId),
            previousIds
          );
          if (party.voiceChannelUrl && party.voiceChannelId) {
            await promptJoinPartyVoice(member.playerName, {
              voiceChannelId: party.voiceChannelId,
              voiceChannelUrl: party.voiceChannelUrl,
            });
          }
        }
      } catch (err) {
        console.error("Failed to sync party voice", err);
      }
      return party;
    }
    // Lost the race â€” another writer touched the row. Re-read and retry.
  }
  return { error: "Party is busy â€” please try again." };
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

    // A member leaving invalidates the whole party's queue entry â€” dequeue
    // the full pre-leave roster (leaver included) once the write commits.
    const prevMembers = [...party.members];
    party.members = party.members.filter((m) => m.discordId !== discordId);

    if (party.members.length === 0) {
      // Guard the delete on the token so we don't drop a party someone just
      // joined between our read and write.
      const del = await client.execute({
        sql: "DELETE FROM web_parties WHERE id = ? AND updated_at = ?",
        args: [id, prevToken],
      });
      if (del.rowsAffected > 0) {
        await dequeueMembers(prevMembers);
        try {
          await deletePartyVoiceChannel(party.voiceChannelId);
        } catch {
          /* ignore */
        }
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
      if (upd.rowsAffected > 0) {
        await dequeueMembers(prevMembers);
        if (party.voiceChannelId) {
          try {
            await syncPartyVoiceMembers(
              party.voiceChannelId,
              party.members.map((m) => m.discordId),
              prevMembers.map((m) => m.discordId)
            );
          } catch {
            /* ignore */
          }
        }
        return getParties();
      }
    }
    // Lost the race â€” re-read and retry.
  }
  return getParties();
}

/** Leader removes another member. Same write path as leave. */
export async function kickMember(
  id: string,
  leaderDiscordId: string,
  targetDiscordId: string
): Promise<{ error?: string }> {
  if (leaderDiscordId === targetDiscordId) {
    return { error: "Leave the party instead of kicking yourself." };
  }
  const party = await getParty(id);
  if (!party) return { error: "Party not found or expired" };
  if (party.leaderId !== leaderDiscordId) {
    return { error: "Only the party leader can kick players." };
  }
  if (!party.members.some((m) => m.discordId === targetDiscordId)) {
    return { error: "They are not in this party." };
  }
  await leaveParty(id, targetDiscordId);
  return {};
}

/** Leader hands captain to another member. Does not dequeue the party. */
export async function transferLeader(
  id: string,
  leaderDiscordId: string,
  targetDiscordId: string
): Promise<{ error?: string }> {
  if (leaderDiscordId === targetDiscordId) {
    return { error: "They are already the party captain." };
  }
  await ensureSchema();
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
    if (party.leaderId !== leaderDiscordId) {
      return { error: "Only the party captain can transfer captain." };
    }
    if (!party.members.some((m) => m.discordId === targetDiscordId)) {
      return { error: "They are not in this party." };
    }
    const prevToken = Number(rs.rows[0].updated_at);
    party.leaderId = targetDiscordId;
    party.updatedAt = Math.max(Date.now(), prevToken + 1);
    const upd = await client.execute({
      sql: "UPDATE web_parties SET data = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
      args: [JSON.stringify(party), party.updatedAt, id, prevToken],
    });
    if (upd.rowsAffected > 0) return {};
  }
  return { error: "Party is busy — please try again." };
}
