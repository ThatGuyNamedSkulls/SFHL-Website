/**
 * Persistent teams for tournament entry. JSON blob per team in web_teams.
 * Separate from clubs (communities) and parties (queue lobbies).
 */

import { cache } from "react";
import { randomUUID } from "crypto";
import { client } from "@/lib/db";
import { isQueueRegion, type QueueRegionId } from "@/lib/regions";
import { MAX_TEAM_MEMBERS, fullMessage, hasRoom, openSlot, type RosterSlot, type TeamRole } from "@/lib/team-roster";

export { MAX_TEAM_MEMBERS, type TeamRole };
export type TeamMemberStatus = "invited" | "accepted";

export interface TeamMember {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: TeamRole;
  status: TeamMemberStatus;
  joinedAt: number;
}

export interface Team {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
  region: QueueRegionId;
  captainId: string;
  captainName: string;
  members: TeamMember[];
  /** "About" on the team page (D4). */
  description?: string | null;
  /** Banner image URL for the team page header (else generated art). */
  bannerUrl?: string | null;
  createdAt: number;
  updatedAt: number;
}

export const DESCRIPTION_MAX = 500;

export const MAX_OWNED_TEAMS = 3;
const DEFAULT_REGION: QueueRegionId = "EU";
const TAG_RE = /^[A-Z0-9]{2,5}$/;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      // One round trip (Turso is remote).
      await client.batch(
        [
          `CREATE TABLE IF NOT EXISTS web_teams (
             id TEXT PRIMARY KEY,
             data TEXT NOT NULL,
             updated_at INTEGER NOT NULL
           )`,
          "CREATE INDEX IF NOT EXISTS idx_web_teams_updated ON web_teams (updated_at)",
        ],
        "write"
      );
    })();
  }
  return schemaReady;
}

function newId() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function cleanName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").slice(0, 32);
}

function cleanTag(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function cleanColor(raw: string) {
  const c = raw.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : "#ff5500";
}

async function loadAll(): Promise<Team[]> {
  await ensureSchema();
  const rs = await client.execute("SELECT data FROM web_teams");
  const out: Team[] = [];
  for (const row of rs.rows) {
    try {
      out.push(JSON.parse(String(row.data)) as Team);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function save(team: Team): Promise<void> {
  await ensureSchema();
  team.updatedAt = Date.now();
  await client.execute({
    sql: `INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    args: [team.id, JSON.stringify(team), team.updatedAt],
  });
}

async function remove(id: string): Promise<void> {
  await ensureSchema();
  await client.execute({ sql: "DELETE FROM web_teams WHERE id = ?", args: [id] });
}

export async function getTeam(id: string): Promise<Team | null> {
  await ensureSchema();
  const rs = await client.execute({ sql: "SELECT data FROM web_teams WHERE id = ?", args: [id] });
  const raw = rs.rows[0]?.data;
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as Team;
  } catch {
    return null;
  }
}

export const listTeams = cache(async function listTeams(): Promise<Team[]> {
  const teams = await loadAll();
  return teams.sort((a, b) => b.updatedAt - a.updatedAt);
});

export async function teamsForMember(discordId: string): Promise<Team[]> {
  const teams = await loadAll();
  return teams
    .filter((t) => t.members.some((m) => m.discordId === discordId && m.status === "accepted"))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function teamsCaptainedBy(discordId: string): Promise<Team[]> {
  const teams = await loadAll();
  return teams.filter((t) => t.captainId === discordId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function ownedTeamCount(discordId: string): Promise<number> {
  return (await teamsCaptainedBy(discordId)).length;
}

export function summarizeTeam(team: Team) {
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    logoUrl: team.logoUrl,
    accentColor: team.accentColor,
    region: team.region,
    captainId: team.captainId,
    captainName: team.captainName,
    memberCount: team.members.filter((m) => m.status === "accepted").length,
    maxMembers: MAX_TEAM_MEMBERS,
    updatedAt: team.updatedAt,
  };
}

export async function createTeam(input: {
  name: string;
  tag: string;
  region?: string;
  logoUrl?: string | null;
  accentColor?: string;
  captain: {
    discordId: string;
    username: string;
    playerName: string | null;
    avatar: string | null;
  };
}): Promise<Team> {
  const name = cleanName(input.name);
  const tag = cleanTag(input.tag);
  if (name.length < 2) throw new Error("Team name must be at least 2 characters.");
  if (!TAG_RE.test(tag)) throw new Error("Tag must be 2–5 letters or numbers.");
  if ((await ownedTeamCount(input.captain.discordId)) >= MAX_OWNED_TEAMS) {
    throw new Error(`You can captain at most ${MAX_OWNED_TEAMS} teams.`);
  }
  const region = isQueueRegion(input.region || "") ? (input.region as QueueRegionId) : DEFAULT_REGION;
  const now = Date.now();
  const team: Team = {
    id: newId(),
    name,
    tag,
    logoUrl: input.logoUrl?.trim() || null,
    accentColor: cleanColor(input.accentColor || "#ff5500"),
    region,
    captainId: input.captain.discordId,
    captainName: input.captain.playerName || input.captain.username,
    members: [
      {
        discordId: input.captain.discordId,
        username: input.captain.username,
        playerName: input.captain.playerName,
        avatar: input.captain.avatar,
        role: "captain",
        status: "accepted",
        joinedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  await save(team);
  return team;
}

export async function inviteToTeam(
  teamId: string,
  byDiscordId: string,
  invitee: {
    discordId: string;
    username: string;
    playerName: string | null;
    avatar: string | null;
  },
  /** The slot to invite into; default: the main roster while it has room, then the bench. */
  slot?: RosterSlot
): Promise<Team> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== byDiscordId) throw new Error("Only the captain can invite.");
  if (team.members.some((m) => m.discordId === invitee.discordId)) {
    throw new Error("That player is already on the team.");
  }
  const role = slot ?? openSlot(team.members);
  if (!role) throw new Error(`Teams are capped at ${MAX_TEAM_MEMBERS} members (5 main roster, 6 subs, 1 coach).`);
  if (!hasRoom(team.members, role)) throw new Error(fullMessage(role));
  team.members.push({
    discordId: invitee.discordId,
    username: invitee.username,
    playerName: invitee.playerName,
    avatar: invitee.avatar,
    role,
    status: "invited",
    joinedAt: Date.now(),
  });
  await save(team);
  return team;
}

export async function respondToInvite(
  teamId: string,
  discordId: string,
  accept: boolean
): Promise<Team | null> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  const idx = team.members.findIndex((m) => m.discordId === discordId && m.status === "invited");
  if (idx < 0) throw new Error("No invite for you on this team.");
  if (!accept) {
    team.members.splice(idx, 1);
    await save(team);
    return team;
  }
  if (team.members.filter((m) => m.status === "accepted").length >= MAX_TEAM_MEMBERS) {
    throw new Error("This team is full.");
  }
  team.members[idx].status = "accepted";
  team.members[idx].joinedAt = Date.now();
  await save(team);
  return team;
}

export async function kickFromTeam(
  teamId: string,
  byDiscordId: string,
  targetDiscordId: string
): Promise<Team> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== byDiscordId) throw new Error("Only the captain can kick.");
  if (targetDiscordId === team.captainId) throw new Error("You can't kick the captain.");
  team.members = team.members.filter((m) => m.discordId !== targetDiscordId);
  await save(team);
  return team;
}

export async function setMemberRole(
  teamId: string,
  byDiscordId: string,
  targetDiscordId: string,
  role: TeamRole
): Promise<Team> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== byDiscordId) throw new Error("Only the captain can change roles.");
  if (role === "captain") throw new Error("Transfer ownership to change captain.");
  const member = team.members.find((m) => m.discordId === targetDiscordId && m.status === "accepted");
  if (!member) throw new Error("Player is not on the team.");
  if (member.role === "captain") throw new Error("Can't demote the captain this way.");
  if (member.role !== role && !hasRoom(team.members, role, member.discordId)) throw new Error(fullMessage(role));
  member.role = role;
  await save(team);
  return team;
}

export async function leaveTeam(teamId: string, discordId: string): Promise<Team | null> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId === discordId) throw new Error("Transfer ownership or delete the team first.");
  team.members = team.members.filter((m) => m.discordId !== discordId);
  await save(team);
  return team;
}

export async function transferCaptain(
  teamId: string,
  byDiscordId: string,
  newCaptainId: string
): Promise<Team> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== byDiscordId) throw new Error("Only the captain can transfer.");
  const next = team.members.find((m) => m.discordId === newCaptainId && m.status === "accepted");
  if (!next) throw new Error("New captain must be an accepted member.");
  if (next.role === "coach") throw new Error("The captain must be a player, not the coach.");
  // Swap: the old captain takes the new captain's slot, so the slot counts stay the same.
  const prev = team.members.find((m) => m.discordId === byDiscordId);
  if (prev) prev.role = next.role === "sub" ? "sub" : "starter";
  next.role = "captain";
  team.captainId = next.discordId;
  team.captainName = next.playerName || next.username;
  await save(team);
  return team;
}

export async function patchTeam(
  teamId: string,
  byDiscordId: string,
  patch: {
    name?: string;
    tag?: string;
    logoUrl?: string | null;
    bannerUrl?: string | null;
    description?: string | null;
    accentColor?: string;
    region?: string;
  }
): Promise<Team> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== byDiscordId) throw new Error("Only the captain can edit.");
  if (patch.name != null) {
    const name = cleanName(patch.name);
    if (name.length < 2) throw new Error("Team name must be at least 2 characters.");
    team.name = name;
  }
  if (patch.tag != null) {
    const tag = cleanTag(patch.tag);
    if (!TAG_RE.test(tag)) throw new Error("Tag must be 2–5 letters or numbers.");
    team.tag = tag;
  }
  if (patch.logoUrl !== undefined) team.logoUrl = patch.logoUrl?.trim() || null;
  if (patch.bannerUrl !== undefined) team.bannerUrl = patch.bannerUrl?.trim().slice(0, 500) || null;
  if (patch.description !== undefined) team.description = patch.description?.trim().slice(0, DESCRIPTION_MAX) || null;
  if (patch.accentColor != null) team.accentColor = cleanColor(patch.accentColor);
  if (patch.region != null && isQueueRegion(patch.region)) team.region = patch.region;
  await save(team);
  return team;
}

export async function deleteTeam(teamId: string, byDiscordId: string): Promise<void> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== byDiscordId) throw new Error("Only the captain can delete.");
  await remove(teamId);
}
