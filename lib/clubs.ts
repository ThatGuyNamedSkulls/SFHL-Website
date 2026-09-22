/**
 * Turso-backed clubs: open or invite-only communities.
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
import { forget, remember } from "@/lib/server-cache";

export const OWNER_ROLE_ID = "owner";
export const MEMBER_ROLE_ID = "member";
export const MAX_CLUB_ROLES = 7;
export const MAX_OWNED_CLUBS = 3;
export const CLUB_CREATE_COST = 2000;
/** Stored preference: show no club tag. Null / missing preference = auto. */
export const HIDE_CLUB_TAG_ID = "none";

export interface ClubRoleDef {
  id: string;
  name: string;
  rank: number;
  canInvite: boolean;
  canKick: boolean;
  canPromote: boolean;
  canEdit: boolean;
  builtin: boolean;
}

export interface ClubInvite {
  token: string;
  createdBy: string;
  createdAt: number;
}

export interface ClubMember {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: string;
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
  private: boolean;
  roles: ClubRoleDef[];
  invites: ClubInvite[];
  members: ClubMember[];
  createdAt: number;
  updatedAt: number;
}

export interface ClubLeaderboardRow {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: string;
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
  private?: boolean;
}

export interface ClubRolePatch {
  name?: string;
  canInvite?: boolean;
  canKick?: boolean;
  canPromote?: boolean;
  canEdit?: boolean;
}

const DEFAULT_REGION: QueueRegionId = "EU";
const DEFAULT_ACCENT = DEFAULT_PROFILE_BACKGROUNDS[1].color;
const ACCENT_SET = new Set<string>(DEFAULT_PROFILE_BACKGROUNDS.map((bg) => bg.color));
const TAG_RE = /^[A-Z0-9]{2,5}$/;
const LOGO_MAX = 500;
const ROLE_NAME_MAX = 24;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_clubs (
           id TEXT PRIMARY KEY,
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      );
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_club_tag_pref (
           discord_id TEXT PRIMARY KEY,
           club_id TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      );
      await client
        .execute("CREATE INDEX IF NOT EXISTS idx_web_clubs_updated ON web_clubs (updated_at)")
        .catch(() => undefined);
      await client
        .execute("CREATE INDEX IF NOT EXISTS idx_web_club_tag_pref_club ON web_club_tag_pref (club_id)")
        .catch(() => undefined);
    })().then(() => undefined);
  }
  return schemaReady;
}

export function forgetClubTagIndex() {
  forget("club-tag-index");
}

export async function getClubTagPref(discordId: string): Promise<string | null> {
  if (!discordId) return null;
  await ensureSchema();
  const rs = await client.execute({
    sql: "SELECT club_id FROM web_club_tag_pref WHERE CAST(discord_id AS TEXT) = CAST(? AS TEXT)",
    args: [discordId],
  });
  const value = String(rs.rows[0]?.club_id ?? "").trim();
  return value || null;
}

export async function setClubTagPref(discordId: string, clubId: string | null): Promise<void> {
  if (!discordId) return;
  await ensureSchema();
  if (!clubId) {
    await client.execute({
      sql: "DELETE FROM web_club_tag_pref WHERE CAST(discord_id AS TEXT) = CAST(? AS TEXT)",
      args: [discordId],
    });
    forgetClubTagIndex();
    return;
  }
  await client.execute({
    sql: `INSERT OR REPLACE INTO web_club_tag_pref (discord_id, club_id, updated_at)
          VALUES (?, ?, ?)`,
    args: [discordId, clubId, Date.now()],
  });
  forgetClubTagIndex();
}

export async function clearClubTagPrefIf(discordId: string, clubId: string): Promise<void> {
  const current = await getClubTagPref(discordId);
  if (current === clubId) await setClubTagPref(discordId, null);
}

async function listClubTagPrefs(): Promise<{ discordId: string; clubId: string }[]> {
  await ensureSchema();
  const rs = await client.execute("SELECT discord_id, club_id FROM web_club_tag_pref");
  return rs.rows
    .map((row) => ({
      discordId: String(row.discord_id ?? ""),
      clubId: String(row.club_id ?? "").trim(),
    }))
    .filter((row) => row.discordId && row.clubId);
}

async function writeClub(club: Club): Promise<Club> {
  await ensureSchema();
  club.updatedAt = Date.now();
  await client.execute({
    sql: "INSERT OR REPLACE INTO web_clubs (id, data, updated_at) VALUES (?, ?, ?)",
    args: [club.id, JSON.stringify(club), club.updatedAt],
  });
  forgetClubTagIndex();
  return club;
}

export function defaultClubRoles(): ClubRoleDef[] {
  return [
    {
      id: OWNER_ROLE_ID,
      name: "Owner",
      rank: 0,
      canInvite: true,
      canKick: true,
      canPromote: true,
      canEdit: true,
      builtin: true,
    },
    {
      id: MEMBER_ROLE_ID,
      name: "Member",
      rank: 100,
      canInvite: false,
      canKick: false,
      canPromote: false,
      canEdit: false,
      builtin: true,
    },
  ];
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

function slugRole(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
  return slug || `role-${randomUUID().slice(0, 4)}`;
}

function normalizeRoles(raw: unknown): ClubRoleDef[] {
  const defaults = defaultClubRoles();
  const incoming = Array.isArray(raw) ? (raw as ClubRoleDef[]) : [];
  const byId = new Map<string, ClubRoleDef>();
  for (const role of incoming) {
    if (!role?.id || !role?.name) continue;
    byId.set(role.id, {
      id: String(role.id).slice(0, 24),
      name: String(role.name).trim().slice(0, ROLE_NAME_MAX) || "Role",
      rank: Number(role.rank) || 50,
      canInvite: !!role.canInvite,
      canKick: !!role.canKick,
      canPromote: !!role.canPromote,
      canEdit: !!role.canEdit,
      builtin: !!role.builtin,
    });
  }
  const owner = { ...defaults[0], ...byId.get(OWNER_ROLE_ID), id: OWNER_ROLE_ID, builtin: true, rank: 0 };
  const member = { ...defaults[1], ...byId.get(MEMBER_ROLE_ID), id: MEMBER_ROLE_ID, builtin: true, rank: 100 };
  const custom = [...byId.values()]
    .filter((r) => r.id !== OWNER_ROLE_ID && r.id !== MEMBER_ROLE_ID)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_CLUB_ROLES - 2)
    .map((r, i) => ({ ...r, builtin: false, rank: Math.min(99, Math.max(1, r.rank || 10 * (i + 1))) }));
  return [owner, ...custom, member];
}

function parseClub(raw: unknown): Club | null {
  try {
    const club = JSON.parse(String(raw)) as Club;
    if (!club?.id || !Array.isArray(club.members)) return null;
    const tag = TAG_RE.test(normalizeClubTag(club.tag || ""))
      ? normalizeClubTag(club.tag)
      : fallbackTag(club.name || "");
    const roles = normalizeRoles(club.roles);
    const validRoleIds = new Set(roles.map((r) => r.id));
    const members = club.members.map((m) => {
      let role = m.role === "officer" ? MEMBER_ROLE_ID : m.role || MEMBER_ROLE_ID;
      if (m.discordId === club.ownerId) role = OWNER_ROLE_ID;
      if (!validRoleIds.has(role)) role = MEMBER_ROLE_ID;
      return { ...m, role };
    });
    return {
      ...club,
      tag,
      accentColor: isClubAccentColor(club.accentColor) ? club.accentColor : DEFAULT_ACCENT,
      logoUrl: typeof club.logoUrl === "string" && club.logoUrl.trim() ? club.logoUrl.trim() : null,
      private: !!club.private,
      roles,
      invites: Array.isArray(club.invites) ? club.invites : [],
      members,
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

export async function ownedClubCount(discordId: string): Promise<number> {
  const clubs = await listClubs();
  return clubs.filter((club) => club.ownerId === discordId).length;
}

async function tagTaken(tag: string, exceptId?: string): Promise<boolean> {
  const clubs = await listClubs();
  return clubs.some((club) => club.tag === tag && club.id !== exceptId);
}

export function roleById(club: Club, roleId: string): ClubRoleDef {
  return club.roles.find((r) => r.id === roleId) ?? club.roles[club.roles.length - 1];
}

export function memberOf(club: Club, discordId: string): ClubMember | undefined {
  return club.members.find((m) => m.discordId === discordId);
}

export function actorCan(
  club: Club,
  discordId: string,
  perm: "canInvite" | "canKick" | "canPromote" | "canEdit"
): boolean {
  if (club.ownerId === discordId) return true;
  const member = memberOf(club, discordId);
  if (!member) return false;
  return !!roleById(club, member.role)[perm];
}

export function sortMembersByRole(club: Club): ClubMember[] {
  return [...club.members].sort((a, b) => {
    const ra = roleById(club, a.role).rank;
    const rb = roleById(club, b.role).rank;
    if (ra !== rb) return ra - rb;
    const an = (a.playerName || a.username).toLowerCase();
    const bn = (b.playerName || b.username).toLowerCase();
    return an.localeCompare(bn);
  });
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
    private: !!club.private,
  };
}

export function clubForClient(club: Club, viewerId?: string | null) {
  const canSeeInvites = viewerId ? actorCan(club, viewerId, "canInvite") : false;
  return {
    ...club,
    members: sortMembersByRole(club),
    invites: canSeeInvites ? club.invites : [],
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
  private?: boolean;
  owner: Omit<ClubMember, "role" | "joinedAt">;
}): Promise<Club> {
  const name = input.name.trim().slice(0, 40);
  if (name.length < 3) throw new Error("Club name must be at least 3 characters.");
  const tag = assertClubTag(input.tag?.trim() ? input.tag : fallbackTag(name));
  if (await tagTaken(tag)) throw new Error("That club tag is already in use.");
  if ((await ownedClubCount(input.owner.discordId)) >= MAX_OWNED_CLUBS) {
    throw new Error(`You can own at most ${MAX_OWNED_CLUBS} clubs.`);
  }
  const accentColor = assertAccent(input.accentColor);
  const logoUrl = assertLogoUrl(input.logoUrl);
  const rawRegion = input.region ?? "";
  const region: QueueRegionId = isQueueRegion(rawRegion) ? rawRegion : DEFAULT_REGION;
  const now = Date.now();
  const owner: ClubMember = { ...input.owner, role: OWNER_ROLE_ID, joinedAt: now };
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
    private: !!input.private,
    roles: defaultClubRoles(),
    invites: [],
    members: [owner],
    createdAt: now,
    updatedAt: now,
  };
  return writeClub(club);
}

export async function updateClub(id: string, discordId: string, patch: ClubPatch): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (!actorCan(club, discordId, "canEdit") && club.ownerId !== discordId) {
    throw new Error("You cannot edit this club.");
  }
  const ownerOnly = club.ownerId === discordId;
  if (typeof patch.name === "string") {
    if (!ownerOnly) throw new Error("Only the owner can change the club name.");
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
    if (!ownerOnly) throw new Error("Only the owner can change the club tag.");
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
  if (typeof patch.private === "boolean") {
    if (!ownerOnly) throw new Error("Only the owner can change club privacy.");
    club.private = patch.private;
  }
  return writeClub(club);
}

export async function joinClub(
  id: string,
  member: Omit<ClubMember, "role" | "joinedAt">,
  inviteToken?: string
): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.members.some((existing) => existing.discordId === member.discordId)) return club;
  if (club.private) {
    const token = (inviteToken || "").trim();
    if (!token || !club.invites.some((inv) => inv.token === token)) {
      throw new Error("This club is invite-only.");
    }
  }
  club.members.push({ ...member, role: MEMBER_ROLE_ID, joinedAt: Date.now() });
  return writeClub(club);
}

export async function leaveClub(id: string, discordId: string): Promise<Club | null> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId === discordId) {
    throw new Error("The owner cannot leave. Transfer the club or delete it.");
  }
  club.members = club.members.filter((m) => m.discordId !== discordId);
  await clearClubTagPrefIf(discordId, club.id);
  return writeClub(club);
}

export async function deleteClub(id: string, discordId: string): Promise<void> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== discordId) throw new Error("Only the owner can delete this club.");
  await ensureSchema();
  await client.execute({ sql: "DELETE FROM web_clubs WHERE id = ?", args: [id] });
  for (const member of club.members) {
    await clearClubTagPrefIf(member.discordId, club.id);
  }
  forgetClubTagIndex();
}

export async function createInvite(id: string, discordId: string): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (!actorCan(club, discordId, "canInvite")) throw new Error("You cannot invite players.");
  club.invites = [
    { token: randomUUID().replace(/-/g, "").slice(0, 10), createdBy: discordId, createdAt: Date.now() },
    ...club.invites,
  ].slice(0, 5);
  return writeClub(club);
}

export async function kickMember(id: string, actorId: string, targetId: string): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (actorId === targetId) throw new Error("Leave the club instead of kicking yourself.");
  if (!actorCan(club, actorId, "canKick")) throw new Error("You cannot kick members.");
  const target = memberOf(club, targetId);
  if (!target) throw new Error("They are not in this club.");
  if (target.role === OWNER_ROLE_ID || targetId === club.ownerId) {
    throw new Error("The owner cannot be kicked.");
  }
  const actor = memberOf(club, actorId);
  const actorRank = actor ? roleById(club, actor.role).rank : 999;
  const targetRank = roleById(club, target.role).rank;
  if (club.ownerId !== actorId && targetRank <= actorRank) {
    throw new Error("You can only kick members below your role.");
  }
  club.members = club.members.filter((m) => m.discordId !== targetId);
  await clearClubTagPrefIf(targetId, club.id);
  return writeClub(club);
}

export async function setMemberRole(
  id: string,
  actorId: string,
  targetId: string,
  roleId: string
): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (!actorCan(club, actorId, "canPromote")) throw new Error("You cannot change member roles.");
  const target = memberOf(club, targetId);
  if (!target) throw new Error("They are not in this club.");
  if (targetId === club.ownerId || target.role === OWNER_ROLE_ID) {
    throw new Error("The owner's role cannot be changed.");
  }
  if (roleId === OWNER_ROLE_ID) throw new Error("Owner cannot be assigned this way.");
  const next = roleById(club, roleId);
  if (!club.roles.some((r) => r.id === roleId)) throw new Error("Unknown role.");
  const actor = memberOf(club, actorId);
  const actorRank = actor ? roleById(club, actor.role).rank : 999;
  const targetRank = roleById(club, target.role).rank;
  if (club.ownerId !== actorId) {
    if (targetRank <= actorRank) throw new Error("You can only manage members below your role.");
    if (next.rank <= actorRank) throw new Error("You can only assign roles below yours.");
  }
  target.role = roleId;
  return writeClub(club);
}

export async function transferOwnership(
  id: string,
  actorId: string,
  targetId: string
): Promise<Club> {
  if (actorId === targetId) throw new Error("You already own this club.");
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== actorId) throw new Error("Only the owner can transfer the club.");
  const target = memberOf(club, targetId);
  if (!target) throw new Error("They must be a member of the club first.");
  if ((await ownedClubCount(targetId)) >= MAX_OWNED_CLUBS) {
    throw new Error(`That player already owns ${MAX_OWNED_CLUBS} clubs.`);
  }
  const prev = memberOf(club, actorId);
  if (prev) prev.role = MEMBER_ROLE_ID;
  target.role = OWNER_ROLE_ID;
  club.ownerId = target.discordId;
  club.ownerName = target.playerName || target.username;
  return writeClub(club);
}

export async function addClubRole(
  id: string,
  actorId: string,
  input: { name: string } & ClubRolePatch
): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== actorId) throw new Error("Only the owner can create roles.");
  if (club.roles.length >= MAX_CLUB_ROLES) {
    throw new Error(`A club can have at most ${MAX_CLUB_ROLES} roles.`);
  }
  const name = input.name.trim().slice(0, ROLE_NAME_MAX);
  if (name.length < 2) throw new Error("Role name must be at least 2 characters.");
  let roleId = slugRole(name);
  if (club.roles.some((r) => r.id === roleId)) roleId = `${roleId}-${randomUUID().slice(0, 3)}`;
  const customCount = club.roles.filter((r) => !r.builtin).length;
  club.roles = normalizeRoles([
    ...club.roles,
    {
      id: roleId,
      name,
      rank: 10 * (customCount + 1),
      canInvite: !!input.canInvite,
      canKick: !!input.canKick,
      canPromote: !!input.canPromote,
      canEdit: !!input.canEdit,
      builtin: false,
    },
  ]);
  return writeClub(club);
}

export async function updateClubRole(
  id: string,
  actorId: string,
  roleId: string,
  patch: ClubRolePatch
): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== actorId) throw new Error("Only the owner can edit roles.");
  if (roleId === OWNER_ROLE_ID || roleId === MEMBER_ROLE_ID) {
    throw new Error("Default roles cannot be edited.");
  }
  const role = club.roles.find((r) => r.id === roleId);
  if (!role) throw new Error("Unknown role.");
  if (typeof patch.name === "string") {
    const name = patch.name.trim().slice(0, ROLE_NAME_MAX);
    if (name.length < 2) throw new Error("Role name must be at least 2 characters.");
    role.name = name;
  }
  if (typeof patch.canInvite === "boolean") role.canInvite = patch.canInvite;
  if (typeof patch.canKick === "boolean") role.canKick = patch.canKick;
  if (typeof patch.canPromote === "boolean") role.canPromote = patch.canPromote;
  if (typeof patch.canEdit === "boolean") role.canEdit = patch.canEdit;
  club.roles = normalizeRoles(club.roles);
  return writeClub(club);
}

export async function deleteClubRole(id: string, actorId: string, roleId: string): Promise<Club> {
  const club = await getClub(id);
  if (!club) throw new Error("Club not found.");
  if (club.ownerId !== actorId) throw new Error("Only the owner can delete roles.");
  if (roleId === OWNER_ROLE_ID || roleId === MEMBER_ROLE_ID) {
    throw new Error("Default roles cannot be deleted.");
  }
  if (!club.roles.some((r) => r.id === roleId)) throw new Error("Unknown role.");
  club.roles = normalizeRoles(club.roles.filter((r) => r.id !== roleId));
  for (const member of club.members) {
    if (member.role === roleId) member.role = MEMBER_ROLE_ID;
  }
  return writeClub(club);
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
                   discord_id, discord_avatar, discord_username
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
                   discord_id, discord_avatar, discord_username
            FROM players
            WHERE ${missingIds.map(() => "discord_id = ?").join(" OR ")}`,
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

export interface ClubTagIndex {
  byName: Record<string, string>;
  byDiscord: Record<string, string>;
}

/** Prefer a club the player owns, else their most recently updated membership. */
export async function clubTagIndex(): Promise<ClubTagIndex> {
  return remember("club-tag-index", 5000, async () => {
    const clubs = await listClubs();
    const byName: Record<string, string> = {};
    const byDiscord: Record<string, string> = {};
    const ranked = [...clubs].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const club of ranked) {
      for (const member of club.members) {
        const owned = member.discordId === club.ownerId;
        if (member.discordId && (owned || !byDiscord[member.discordId])) {
          byDiscord[member.discordId] = club.tag;
        }
        const key = (member.playerName || "").trim().toLowerCase();
        if (key && (owned || !byName[key])) byName[key] = club.tag;
      }
    }
    const prefs = await listClubTagPrefs();
    if (prefs.length) {
      const clubById = new Map(clubs.map((club) => [club.id, club]));
      for (const pref of prefs) {
        const memberClubs = clubs.filter((club) =>
          club.members.some((m) => m.discordId === pref.discordId)
        );
        const names = [
          ...new Set(
            memberClubs
              .flatMap((club) =>
                club.members
                  .filter((m) => m.discordId === pref.discordId)
                  .map((m) => (m.playerName || "").trim().toLowerCase())
              )
              .filter(Boolean)
          ),
        ];
        if (pref.clubId === HIDE_CLUB_TAG_ID) {
          byDiscord[pref.discordId] = "";
          for (const key of names) byName[key] = "";
          continue;
        }
        const chosen = clubById.get(pref.clubId);
        if (!chosen || !chosen.members.some((m) => m.discordId === pref.discordId)) {
          continue;
        }
        byDiscord[pref.discordId] = chosen.tag;
        for (const key of names) byName[key] = chosen.tag;
      }
    }
    return { byName, byDiscord };
  });
}

export function lookupClubTag(
  index: ClubTagIndex,
  playerName?: string | null,
  discordId?: string | null
): string | null {
  if (discordId && Object.prototype.hasOwnProperty.call(index.byDiscord, discordId)) {
    return index.byDiscord[discordId] || null;
  }
  const key = (playerName || "").trim().toLowerCase();
  if (key && Object.prototype.hasOwnProperty.call(index.byName, key)) {
    return index.byName[key] || null;
  }
  return null;
}
