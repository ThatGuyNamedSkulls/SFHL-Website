/**
 * Turso-backed clubs: open communities anyone can create or join.
 * Same JSON-blob pattern as web_parties (one row per club).
 */

import { randomUUID } from "crypto";
import {
  client,
  ensurePlayerDiscordColumns,
  mapRank,
  type DbPlayer,
} from "@/lib/db";
import { DEFAULT_PROFILE_BACKGROUNDS } from "@/lib/profile-backgrounds";
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
  tag: string;
  accentColor: string;
  logoUrl: string | null;
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

export interface ClubLeaderboardRow {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: ClubRole;
  elo: number;
  rank: string;
  placementDone: boolean;
}

export interface ClubPatch {
  name?: string;
  description?: string;
  rules?: string;
  tag?: string;
  accentColor?: string;
  logoUrl?: string | null;
}

const DEFAULT_REGION: QueueRegionId = "EU";
const DEFAULT_ACCENT = DEFAULT_PROFILE_BACKGROUNDS[1].color; // Orange
const ACCENT_SET = new Set<string>(DEFAULT_PROFILE_BACKGROUNDS.map((bg) => bg.color));
const TAG_RE = /^[A-Z0-9]{2,5}$/;
const LOGO_MAX = 500;

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

export function normalizeClubTag(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

export function assertClubTag(raw: string): string {
  const tag = normalizeClubTag(raw);
  if (!TAG_RE.test(tag)) {
    throw new Error("Club tag must be 2–5 letters or numbers (A–Z, 0–9).");
  }
  return tag;
}

export function isClubAccentColor(value: string | null | undefined): value is string {
  return !!value && ACCENT_SET.has(value);
}

function assertAccent(raw: string | undefined): string {
  const color = (raw ?? "").trim() || DEFAULT_ACCENT;
  if (!isClubAccentColor(color)) {
    throw new Error("Pick a club color from the default palette.");
  }
  return color;
}

function assertLogoUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.length > LOGO_MAX) throw new Error("Logo URL is too long.");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error("Logo URL must be a valid https link.");
  }
  if (url.protocol !== "https:") throw new Error("Logo URL must use https.");
  return url.toString();
}

function fallbackTag(name: string): string {
  const fromName = normalizeClubTag(name);
  if (fromName.length >= 2) return fromName.slice(0, 5);
  return (fromName + "CLUB").slice(0, 4);
}

function parseClub(raw: unknown): Club | null {
  try {
    const club = JSON.parse(String(raw)) as Club;
    if (!club?.id || !Array.isArray(club.members)) return null;
    const tag = TAG_RE.test(normalizeClubTag(club.tag || ""))
      ? normalizeClubTag(club.tag)
      : fallbackTag(club.name || "");
    return {
      ...club,
      tag,
      accentColor: isClubAccentColor(club.accentColor) ? club.accentColor : DEFAULT_ACCENT,
      logoUrl: typeof club.logoUrl === "string" && club.logoUrl.trim() ? club.logoUrl.trim() : null,
    };
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

async function tagTaken(tag: string, exceptId?: string): Promise<boolean> {
  const clubs = await listClubs();
  return clubs.some((club) => club.tag === tag && club.id !== exceptId);
}

export function summarizeClub(club: Club) {
  return {
    id: club.id,
    name: club.name,
    tag: club.tag,
    accentColor: club.accentColor,
    logoUrl: club.logoUrl,
    description: club.description,
    region: club.region,
    ownerId: club.ownerId,
    ownerName: club.ownerName,
    memberCount: club.members.length,
  };
}

export async function createClub(input: {
  name: string;
  tag?: string;
  accentColor?: string;
  logoUrl?: string | null;
  description?: string;
  region?: string;
  rules?: string;
  owner: Omit<ClubMember, "role" | "joinedAt">;
}): Promise<Club> {
  const name = input.name.trim().slice(0, 40);
  if (name.length < 3) throw new Error("Club name must be at least 3 characters.");
  const tag = assertClubTag(input.tag?.trim() ? input.tag : fallbackTag(name));
  if (await tagTaken(tag)) throw new Error("That club tag is already in use.");
  const accentColor = assertAccent(input.accentColor);
  const logoUrl = assertLogoUrl(input.logoUrl);
  const rawRegion = input.region ?? "";
  const region: QueueRegionId = isQueueRegion(rawRegion) ? rawRegion : DEFAULT_REGION;
  const now = Date.now();
  const owner: ClubMember = { ...input.owner, role: "owner", joinedAt: now };
  const club: Club = {
    id: randomUUID().slice(0, 8),
    name,
    tag,
    accentColor,
    logoUrl,
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

export async function updateClub(id: string, discordId: string, patch: ClubPatch): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== discordId) throw new Error("Only the club owner can edit this.");
  if (typeof patch.name === "string") {
    const name = patch.name.trim().slice(0, 40);
    if (name.length < 3) throw new Error("Club name must be at least 3 characters.");
    club.name = name;
  }
  if (typeof patch.description === "string") {
    club.description = patch.description.trim().slice(0, 280);
  }
  if (typeof patch.rules === "string") {
    club.rules = patch.rules.trim().slice(0, 2000);
  }
  if (typeof patch.tag === "string") {
    const tag = assertClubTag(patch.tag);
    if (tag !== club.tag && (await tagTaken(tag, club.id))) {
      throw new Error("That club tag is already in use.");
    }
    club.tag = tag;
  }
  if (typeof patch.accentColor === "string") {
    club.accentColor = assertAccent(patch.accentColor);
  }
  if (patch.logoUrl !== undefined) {
    club.logoUrl = assertLogoUrl(patch.logoUrl);
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

function asPlayer(row: Record<string, unknown>): DbPlayer {
  return row as unknown as DbPlayer;
}

/** Live Elo board for a club. Unranked / unlinked members sit at the bottom. */
export async function clubLeaderboard(club: Club): Promise<ClubLeaderboardRow[]> {
  await ensurePlayerDiscordColumns();
  const byName = new Map<string, DbPlayer>();
  const byDiscord = new Map<string, DbPlayer>();
  const names = [
    ...new Set(
      club.members
        .map((m) => (m.playerName || "").trim())
        .filter((name) => name.length > 0)
    ),
  ];
  const ids = [...new Set(club.members.map((m) => m.discordId).filter(Boolean))];

  if (names.length > 0) {
    const rs = await client.execute({
      sql: `SELECT name, elo, rank, placement_done, roblox_avatar_image,
                   CAST(discord_id AS TEXT) AS discord_id, discord_avatar, discord_username
            FROM players
            WHERE ${names.map(() => "lower(name) = lower(?)").join(" OR ")}`,
      args: names,
    });
    for (const row of rs.rows) {
      const player = asPlayer(row as unknown as Record<string, unknown>);
      byName.set(String(player.name).toLowerCase(), player);
      if (player.discord_id != null) byDiscord.set(String(player.discord_id), player);
    }
  }

  const missingIds = ids.filter((id) => !byDiscord.has(id));
  if (missingIds.length > 0) {
    const rs = await client.execute({
      sql: `SELECT name, elo, rank, placement_done, roblox_avatar_image,
                   CAST(discord_id AS TEXT) AS discord_id, discord_avatar, discord_username
            FROM players
            WHERE ${missingIds.map(() => "CAST(discord_id AS TEXT) = ?").join(" OR ")}`,
      args: missingIds,
    });
    for (const row of rs.rows) {
      const player = asPlayer(row as unknown as Record<string, unknown>);
      if (player.discord_id != null) byDiscord.set(String(player.discord_id), player);
      if (player.name) byName.set(String(player.name).toLowerCase(), player);
    }
  }

  const rows: ClubLeaderboardRow[] = club.members.map((member) => {
    const player =
      (member.playerName ? byName.get(member.playerName.trim().toLowerCase()) : undefined) ||
      byDiscord.get(member.discordId);
    const placementDone = !!player && Number(player.placement_done) === 1;
    const elo = placementDone ? Number(player?.elo) || 0 : 0;
    return {
      discordId: member.discordId,
      username: member.username,
      playerName: member.playerName || player?.name || null,
      avatar: member.avatar || player?.discord_avatar || null,
      role: member.role,
      elo,
      rank: placementDone && player ? mapRank(player.rank) : "UNRANKED",
      placementDone,
    };
  });

  rows.sort((a, b) => {
    if (a.placementDone !== b.placementDone) return a.placementDone ? -1 : 1;
    if (b.elo !== a.elo) return b.elo - a.elo;
    const an = (a.playerName || a.username).toLowerCase();
    const bn = (b.playerName || b.username).toLowerCase();
    return an.localeCompare(bn);
  });
  return rows;
}
