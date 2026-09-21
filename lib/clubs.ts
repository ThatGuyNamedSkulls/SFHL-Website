/**
 * Turso-backed clubs: open communities anyone can create or join.
 * Same JSON-blob pattern as web_parties (one row per club).
 */

import { randomUUID } from "crypto";
import { client } from "@/lib/db";
import { isQueueRegion, type QueueRegionId } from "@/lib/regions";

export type ClubRole = "owner" | "officer" | "member";

export interface ClubMember {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: ClubRole;
  joinedAt: number;
}

export interface Club {
  id: string;
  name: string;
  description: string;
  region: QueueRegionId;
  game: string;
  ownerId: string;
  ownerName: string;
  rules: string;
  members: ClubMember[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_REGION: QueueRegionId = "EU";

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = client
      .execute(
        `CREATE TABLE IF NOT EXISTS web_clubs (
           id TEXT PRIMARY KEY,
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      )
      .then(() => undefined);
  }
  return schemaReady;
}

async function writeClub(club: Club): Promise<Club> {
  await ensureSchema();
  club.updatedAt = Date.now();
  await client.execute({
    sql: "INSERT OR REPLACE INTO web_clubs (id, data, updated_at) VALUES (?, ?, ?)",
    args: [club.id, JSON.stringify(club), club.updatedAt],
  });
  return club;
}

function parseClub(raw: unknown): Club | null {
  try {
    const club = JSON.parse(String(raw)) as Club;
    if (!club?.id || !Array.isArray(club.members)) return null;
    return club;
  } catch {
    return null;
  }
}

export async function listClubs(): Promise<Club[]> {
  await ensureSchema();
  const rs = await client.execute("SELECT data FROM web_clubs ORDER BY updated_at DESC");
  return rs.rows.map((row) => parseClub(row.data)).filter((club): club is Club => !!club);
}

export async function getClub(id: string): Promise<Club | null> {
  await ensureSchema();
  const rs = await client.execute({
    sql: "SELECT data FROM web_clubs WHERE id = ?",
    args: [id],
  });
  if (rs.rows.length === 0) return null;
  return parseClub(rs.rows[0].data);
}

export async function clubsForMember(discordId: string): Promise<Club[]> {
  const clubs = await listClubs();
  return clubs.filter((club) => club.members.some((m) => m.discordId === discordId));
}

export async function clubsForPlayer(playerName: string): Promise<Club[]> {
  const key = playerName.trim().toLowerCase();
  if (!key) return [];
  const clubs = await listClubs();
  return clubs.filter((club) =>
    club.members.some((m) => (m.playerName || "").toLowerCase() === key)
  );
}

export function summarizeClub(club: Club) {
  return {
    id: club.id,
    name: club.name,
    description: club.description,
    region: club.region,
    ownerId: club.ownerId,
    ownerName: club.ownerName,
    memberCount: club.members.length,
  };
}

export async function createClub(input: {
  name: string;
  description?: string;
  region?: string;
  rules?: string;
  owner: Omit<ClubMember, "role" | "joinedAt">;
}): Promise<Club> {
  const name = input.name.trim().slice(0, 40);
  if (name.length < 3) throw new Error("Club name must be at least 3 characters.");
  const rawRegion = input.region ?? "";
  const region: QueueRegionId = isQueueRegion(rawRegion) ? rawRegion : DEFAULT_REGION;
  const now = Date.now();
  const owner: ClubMember = { ...input.owner, role: "owner", joinedAt: now };
  const club: Club = {
    id: randomUUID().slice(0, 8),
    name,
    description: (input.description ?? "").trim().slice(0, 280),
    region,
    game: "Strike Force",
    ownerId: owner.discordId,
    ownerName: owner.playerName || owner.username,
    rules: (input.rules ?? "").trim().slice(0, 2000),
    members: [owner],
    createdAt: now,
    updatedAt: now,
  };
  return writeClub(club);
}

export async function updateClub(
  id: string,
  discordId: string,
  patch: { description?: string; rules?: string }
): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== discordId) throw new Error("Only the club owner can edit this.");
  if (typeof patch.description === "string") {
    club.description = patch.description.trim().slice(0, 280);
  }
  if (typeof patch.rules === "string") {
    club.rules = patch.rules.trim().slice(0, 2000);
  }
  return writeClub(club);
}

export async function joinClub(
  id: string,
  member: Omit<ClubMember, "role" | "joinedAt">
): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.members.some((existing) => existing.discordId === member.discordId)) return club;
  club.members.push({ ...member, role: "member", joinedAt: Date.now() });
  return writeClub(club);
}

export async function leaveClub(id: string, discordId: string): Promise<Club | null> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId === discordId) {
    throw new Error("The owner cannot leave. Transfer the club or delete it.");
  }
  club.members = club.members.filter((m) => m.discordId !== discordId);
  return writeClub(club);
}

export async function deleteClub(id: string, discordId: string): Promise<void> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== discordId) throw new Error("Only the owner can delete this club.");
  await ensureSchema();
  await client.execute({ sql: "DELETE FROM web_clubs WHERE id = ?", args: [id] });
}
