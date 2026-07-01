/**
 * File-based party store for the HyperLeague website.
 *
 * Parties are ephemeral: they live in a shared JSON file at the bot root
 * (`../../web_parties.json`) so the Discord bot can read/write the same file,
 * and they are automatically disbanded 30 minutes after their last change.
 *
 * This intentionally avoids the SQLite DB — parties are temporary and should
 * not clutter the persistent player database.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const PARTIES_PATH =
  process.env.PARTIES_PATH ||
  path.resolve(process.cwd(), "..", "..", "web_parties.json");

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

function readRaw(): Party[] {
  try {
    const raw = fs.readFileSync(PARTIES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Party[]) : [];
  } catch {
    return [];
  }
}

function writeRaw(parties: Party[]): void {
  try {
    fs.writeFileSync(PARTIES_PATH, JSON.stringify(parties, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist parties:", err);
  }
}

/** Read all live parties, pruning any that have expired or emptied. */
export function getParties(): Party[] {
  const now = Date.now();
  const all = readRaw();
  const live = all.filter(
    (p) => p.members.length > 0 && now - p.updatedAt < PARTY_TTL_MS
  );
  if (live.length !== all.length) writeRaw(live);
  return live;
}

export function getParty(id: string): Party | undefined {
  return getParties().find((p) => p.id === id);
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

export function createParty(input: CreatePartyInput): Party {
  const parties = getParties();

  // A user can only lead / belong to one party at a time — remove them elsewhere.
  const cleaned = parties
    .map((p) => ({
      ...p,
      members: p.members.filter((m) => m.discordId !== input.leader.discordId),
    }))
    .filter((p) => p.members.length > 0 && p.leaderId !== input.leader.discordId);

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

  writeRaw([party, ...cleaned]);
  return party;
}

export function joinParty(id: string, member: PartyMember): Party | { error: string } {
  const parties = getParties();
  const party = parties.find((p) => p.id === id);
  if (!party) return { error: "Party not found or expired" };
  if (party.members.some((m) => m.discordId === member.discordId)) return party;
  if (party.members.length >= party.maxSize) return { error: "Party is full" };

  // Remove the joining member from any other party first.
  for (const p of parties) {
    if (p.id !== id) p.members = p.members.filter((m) => m.discordId !== member.discordId);
  }

  party.members.push(member);
  party.updatedAt = Date.now();
  writeRaw(parties.filter((p) => p.members.length > 0));
  return party;
}

export function leaveParty(id: string, discordId: string): Party[] {
  const parties = getParties();
  const party = parties.find((p) => p.id === id);
  if (!party) return getParties();

  party.members = party.members.filter((m) => m.discordId !== discordId);
  party.updatedAt = Date.now();

  // If the leader left, promote the next member; if empty, drop the party.
  if (party.members.length === 0) {
    writeRaw(parties.filter((p) => p.id !== id));
  } else {
    if (party.leaderId === discordId) party.leaderId = party.members[0].discordId;
    writeRaw(parties);
  }
  return getParties();
}
