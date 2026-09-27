/**
 * Website tournaments. Results never write ranked Elo.
 * Official cups are run by Match Staff. Community cups belong to a club.
 */

import { randomUUID } from "crypto";
import { MAP_NAMES } from "@/data/maps";
import { getClub } from "@/lib/clubs";
import { containsProfanity } from "@/lib/content-moderation";
import { client, getPlayer } from "@/lib/db";
import { mutateBlob, type MutateResult } from "@/lib/blob-cas";
import { refundSpend, spendCoins, type CoinMove } from "@/lib/coin-ledger";
import { isQueueRegion } from "@/lib/regions";
import { getTeam, teamsCaptainedBy, type Team } from "@/lib/teams";
import {
  applyResult,
  bracketFinished,
  createBracket,
  placements,
  seriesWins,
} from "@/lib/tournament-bracket";
import {
  DEFAULT_POT_SPLIT,
  type BracketKind,
  type BracketMatch,
  type FieldSize,
  type JoinRequest,
  type MapScore,
  type RosterRole,
  type SeriesLength,
  type Tournament,
  type TournamentKind,
  type TournamentTeam,
} from "@/lib/tournament-types";
import { schemaOnce } from "@/lib/schema-once";

const MAX_OTHERS = 6;
const MAX_STARTERS = 5;
const MAX_SUBS = 2;

export interface TournamentActor {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  staff: boolean;
}

export interface CreateTournamentInput {
  name: string;
  kind: TournamentKind;
  clubId?: string | null;
  region: string;
  bracket: string;
  size: number;
  bo: number;
  entryFee: number;
  potSplit?: number[] | null;
  mapPool: string[];
}

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = schemaOnce("tournaments", async () => {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS web_tournaments (
           id TEXT PRIMARY KEY,
           data TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         )`
      );
      await client.execute("ALTER TABLE web_tournaments ADD COLUMN club_id TEXT").catch(() => undefined);
      await client
        .execute("CREATE INDEX IF NOT EXISTS idx_web_tournaments_club ON web_tournaments (club_id)")
        .catch(() => undefined);
      await client
        .execute("CREATE INDEX IF NOT EXISTS idx_web_tournaments_updated ON web_tournaments (updated_at)")
        .catch(() => undefined);
      await client
        .execute(
          `UPDATE web_tournaments
           SET club_id = json_extract(data, '$.clubId')
           WHERE (club_id IS NULL OR club_id = '')
             AND json_extract(data, '$.clubId') IS NOT NULL`
        )
        .catch(() => undefined);
    })();
  }
  return schemaReady;
}

function parseTournament(raw: unknown): Tournament | null {
  try {
    const row = JSON.parse(String(raw)) as Tournament;
    if (!row?.id || !row.name) return null;
    const split = Array.isArray(row.potSplit) ? row.potSplit.map(Number) : DEFAULT_POT_SPLIT;
    const potSplit: [number, number, number] =
      split.length === 3 && split.every((n) => Number.isInteger(n))
        ? [split[0], split[1], split[2]]
        : DEFAULT_POT_SPLIT;
    return {
      ...row,
      clubId: row.clubId ?? null,
      pot: Number(row.pot) || 0,
      entryFee: Number(row.entryFee) || 0,
      potSplit,
      mapPool: Array.isArray(row.mapPool) ? row.mapPool : [],
      paidOut: !!row.paidOut,
      requests: Array.isArray(row.requests) ? row.requests : [],
      teams: Array.isArray(row.teams) ? row.teams : [],
      matches: Array.isArray(row.matches) ? row.matches : [],
    };
  } catch {
    return null;
  }
}

/** Create a new cup row. Every later change goes through `mutate`. */
async function insertTournament(t: Tournament): Promise<Tournament> {
  await ensureSchema();
  await client.execute({
    sql: "INSERT INTO web_tournaments (id, data, updated_at, club_id) VALUES (?, ?, ?, ?)",
    args: [t.id, JSON.stringify(t), t.updatedAt, t.clubId],
  });
  return t;
}

/**
 * Safe read-modify-write of one cup (lib/blob-cas): `fn` runs on the freshest
 * copy (re-run on a lost race), and any coin moves it returns are applied in
 * the same transaction, at most once per ledger key.
 */
async function mutate(
  id: string,
  fn: (t: Tournament) => MutateResult | void | Promise<MutateResult | void>
): Promise<Tournament> {
  await ensureSchema();
  return mutateBlob<Tournament>({
    table: "web_tournaments",
    id,
    parse: (raw) => parseTournament(raw),
    notFound: "Tournament not found.",
    mutate: async (t) => {
      const result = await fn(t);
      t.updatedAt = Date.now();
      return result;
    },
    columns: (t) => ({ updated_at: t.updatedAt, club_id: t.clubId }),
  });
}

function refundKey(t: Tournament, team: TournamentTeam) {
  return `cup:${t.id}:refund:${team.id}`;
}

export async function listTournaments(): Promise<Tournament[]> {
  await ensureSchema();
  const rs = await client.execute("SELECT data FROM web_tournaments ORDER BY updated_at DESC");
  const weight: Record<string, number> = { live: 0, open: 1, completed: 2, cancelled: 3 };
  return rs.rows
    .map((row) => parseTournament(row.data))
    .filter((t): t is Tournament => !!t)
    .sort((a, b) => (weight[a.status] ?? 9) - (weight[b.status] ?? 9) || b.updatedAt - a.updatedAt);
}

export async function getTournament(id: string): Promise<Tournament | null> {
  await ensureSchema();
  const rs = await client.execute({
    sql: "SELECT data FROM web_tournaments WHERE id = ?",
    args: [id],
  });
  if (!rs.rows.length) return null;
  return parseTournament(rs.rows[0].data);
}

async function mustGet(id: string): Promise<Tournament> {
  const t = await getTournament(id);
  if (!t) throw new Error("Tournament not found.");
  return t;
}

export async function tournamentsForClub(clubId: string): Promise<Tournament[]> {
  await ensureSchema();
  try {
    const rs = await client.execute({
      sql: "SELECT data FROM web_tournaments WHERE club_id = ? ORDER BY updated_at DESC",
      args: [clubId],
    });
    return rs.rows
      .map((row) => parseTournament(row.data))
      .filter((t): t is Tournament => !!t && t.status !== "cancelled" && t.clubId === clubId);
  } catch {
    const all = await listTournaments();
    return all.filter((t) => t.status !== "cancelled" && t.clubId === clubId);
  }
}

async function isOrganizer(t: Tournament, actor: TournamentActor): Promise<boolean> {
  if (t.kind === "official") return actor.staff;
  if (!t.clubId) return false;
  const club = await getClub(t.clubId);
  return !!club && club.ownerId === actor.discordId;
}

async function assertOrganizer(t: Tournament, actor: TournamentActor) {
  if (!(await isOrganizer(t, actor))) {
    throw new Error(
      t.kind === "official"
        ? "Only Match Staff can manage this cup."
        : "Only the clan owner can manage this cup."
    );
  }
}

export async function tournamentViewer(t: Tournament, actor: TournamentActor | null) {
  if (!actor) {
    return {
      organizer: false,
      staff: false,
      captainOf: null as string | null,
      inviteTeamId: null as string | null,
      pendingRequest: false,
      clubMember: false,
    };
  }
  const invite = t.teams.find((team) =>
    team.members.some((m) => m.discordId === actor.discordId && m.status === "invited")
  );
  const captain = t.teams.find((team) => team.captainId === actor.discordId);
  let clubMember = false;
  if (t.kind === "community" && t.clubId) {
    const club = await getClub(t.clubId);
    clubMember = !!club?.members.some((m) => m.discordId === actor.discordId);
  }
  return {
    organizer: await isOrganizer(t, actor),
    staff: actor.staff,
    captainOf: captain?.id ?? null,
    inviteTeamId: invite?.id ?? null,
    pendingRequest: t.requests.some(
      (r) => r.captainId === actor.discordId && r.status === "pending"
    ),
    clubMember,
  };
}

export function presentTournament(t: Tournament, actor: TournamentActor | null, organizer: boolean) {
  const mine = actor?.discordId;
  return {
    ...t,
    requests: organizer
      ? t.requests
      : t.requests.filter((r) => r.status === "pending" && r.captainId === mine),
  };
}

function assertOpen(t: Tournament) {
  if (t.status !== "open") throw new Error("Registration is closed.");
}

function cleanTeamName(t: Tournament, raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 32) {
    throw new Error("Team name must be 2–32 characters.");
  }
  if (containsProfanity(name)) throw new Error("That team name is not allowed.");
  const key = name.toLowerCase();
  if (t.teams.some((team) => team.name.toLowerCase() === key)) {
    throw new Error("That team name is already taken.");
  }
  if (t.requests.some((r) => r.status === "pending" && r.teamName.toLowerCase() === key)) {
    throw new Error("That team name is already requested.");
  }
  return name;
}

/**
 * Entering a tournament requires owning a team: the captain's saved team
 * (web_teams) is what enters. `teamRef` is a team id or name; it may be left
 * empty when the player captains exactly one team.
 */
async function findCaptainedTeam(captainId: string, teamRef: string, self: boolean): Promise<Team> {
  const owned = await teamsCaptainedBy(captainId);
  if (owned.length === 0) {
    throw new Error(
      self
        ? "Only team captains can join tournaments. Create a team first."
        : "That player doesn't captain a team. Only team captains can enter tournaments."
    );
  }
  const ref = teamRef.trim().toLowerCase();
  const team = ref
    ? owned.find((x) => x.id.toLowerCase() === ref || x.name.toLowerCase() === ref)
    : owned.length === 1
      ? owned[0]
      : undefined;
  if (!team) {
    throw new Error(
      ref
        ? self
          ? "You don't captain that team."
          : "That player doesn't captain a team with that name."
        : "Pick which team is entering."
    );
  }
  return team;
}

/** Sync entry checks, re-run on the freshest copy of the cup. Returns the entry name. */
function assertTeamCanEnter(t: Tournament, team: Team): string {
  const entered =
    t.teams.some((x) => x.teamId === team.id) ||
    t.requests.some((r) => r.status === "pending" && r.teamId === team.id);
  if (entered) throw new Error("That team is already entered in this cup.");
  return cleanTeamName(t, team.name);
}

function onTeam(t: Tournament, discordId: string) {
  return t.teams.some((team) => team.members.some((m) => m.discordId === discordId));
}

function pendingRequest(t: Tournament, discordId: string) {
  return t.requests.some((r) => r.captainId === discordId && r.status === "pending");
}

function assertFree(t: Tournament, discordId: string) {
  if (onTeam(t, discordId)) throw new Error("That player is already on a team in this cup.");
  if (pendingRequest(t, discordId)) throw new Error("That player already has a pending request.");
}

async function resolvePlayer(name: string) {
  const player = await getPlayer(name.trim());
  if (!player) throw new Error("Player not found.");
  const discordId = player.discord_id != null ? String(player.discord_id) : "";
  if (!discordId) throw new Error("That player has not linked Discord.");
  return {
    discordId,
    username: (player.discord_username || player.name).trim() || player.name,
    playerName: player.name,
    avatar: player.discord_avatar,
  };
}

/**
 * Take `fee` from `playerName` (atomic, ledgered), run `write`, and give the fee
 * back if the write fails — so a fee is never kept for an entry that wasn't saved.
 */
async function withFee<T>(
  t: Tournament,
  playerName: string,
  fee: number,
  write: () => Promise<T>
): Promise<T> {
  let spendKey: string | null = null;
  if (fee > 0) {
    spendKey = await spendCoins(playerName, fee, `Entry fee: ${t.name}`, `cup:${t.id}:fee`);
    if (!spendKey) throw new Error(`Not enough HL Coins. Entry is ${fee.toLocaleString()}.`);
  }
  try {
    return await write();
  } catch (error) {
    if (spendKey) {
      await refundSpend(spendKey, playerName, fee, `Entry fee returned: ${t.name}`).catch(() => undefined);
    }
    throw error;
  }
}

function makeTeam(input: {
  name: string;
  captainId: string;
  username: string;
  playerName: string;
  avatar: string | null;
  fee: number;
  teamId?: string | null;
}): TournamentTeam {
  return {
    id: randomUUID(),
    teamId: input.teamId ?? null,
    name: input.name,
    captainId: input.captainId,
    paidAmount: input.fee,
    paidBy: input.playerName,
    seed: 0,
    placement: null,
    prizeCredited: false,
    members: [
      {
        discordId: input.captainId,
        username: input.username,
        playerName: input.playerName,
        avatar: input.avatar,
        role: "captain",
        status: "accepted",
      },
    ],
  };
}

function cleanSplit(raw: number[] | null | undefined): [number, number, number] {
  const split = (raw && raw.length === 3 ? raw : DEFAULT_POT_SPLIT).map((n) => Number(n));
  if (
    split.length !== 3 ||
    split.some((n) => !Number.isInteger(n) || n < 0 || n > 100) ||
    split[0] + split[1] + split[2] !== 100
  ) {
    throw new Error("Prize split must be three whole numbers that add up to 100.");
  }
  return [split[0], split[1], split[2]];
}

function cleanMaps(raw: string[], bo: SeriesLength): string[] {
  const pool = [...new Set(raw.map((m) => m.trim()).filter((m) => MAP_NAMES.includes(m)))];
  if (pool.length < bo) {
    throw new Error(`Pick at least ${bo} map${bo === 1 ? "" : "s"} from the pool.`);
  }
  return pool;
}

export async function createTournament(
  input: CreateTournamentInput,
  actor: TournamentActor
): Promise<Tournament> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 40) {
    throw new Error("Cup name must be 3–40 characters.");
  }
  if (containsProfanity(name)) throw new Error("That cup name is not allowed.");
  const region = input.region.toUpperCase();
  if (!isQueueRegion(region)) throw new Error("Pick a matchmaking region.");
  const bracket: BracketKind = input.bracket === "double" ? "double" : input.bracket === "single" ? "single" : "single";
  if (input.bracket !== "single" && input.bracket !== "double") {
    throw new Error("Bracket must be single or double elimination.");
  }
  if (input.size !== 8 && input.size !== 16) throw new Error("Field size must be 8 or 16.");
  const size = input.size as FieldSize;
  if (input.bo !== 1 && input.bo !== 3) throw new Error("Series must be BO1 or BO3.");
  const bo = input.bo as SeriesLength;
  const entryFee = Math.floor(Number(input.entryFee) || 0);
  if (entryFee < 0 || entryFee > 100000) throw new Error("Entry fee must be between 0 and 100,000 coins.");
  const potSplit = cleanSplit(input.potSplit);
  const mapPool = cleanMaps(input.mapPool || [], bo);
  const kind: TournamentKind = input.kind === "community" ? "community" : "official";

  let clubId: string | null = null;
  if (kind === "official") {
    if (!actor.staff) throw new Error("Only Match Staff can create an official cup.");
  } else {
    clubId = (input.clubId || "").trim();
    if (!clubId) throw new Error("Community cups belong to a clan.");
    const club = await getClub(clubId);
    if (!club) throw new Error("Clan not found.");
    if (club.ownerId !== actor.discordId) {
      throw new Error("Only the clan owner can create a community cup.");
    }
  }

  const now = Date.now();
  const tournament: Tournament = {
    id: randomUUID(),
    name,
    kind,
    clubId,
    region,
    bracket,
    size,
    bo,
    entryFee,
    pot: 0,
    potSplit,
    mapPool,
    status: "open",
    createdBy: actor.discordId,
    paidOut: false,
    requests: [],
    teams: [],
    matches: [],
    createdAt: now,
    updatedAt: now,
  };
  return insertTournament(tournament);
}

export async function requestJoin(
  id: string,
  actor: TournamentActor,
  teamId: string
): Promise<Tournament> {
  const pre = await mustGet(id);
  assertOpen(pre);
  if (!actor.playerName) throw new Error("Link a HyperLeague player before requesting a team.");
  const player = await resolvePlayer(actor.playerName);
  if (player.discordId !== actor.discordId) {
    throw new Error("Your linked player does not match this Discord account.");
  }
  if (pre.kind === "community") {
    if (!pre.clubId) throw new Error("This cup is not attached to a clan.");
    const club = await getClub(pre.clubId);
    if (!club || !club.members.some((m) => m.discordId === actor.discordId)) {
      throw new Error("You need to be in the clan to join.");
    }
  }
  const team = await findCaptainedTeam(actor.discordId, teamId, true);
  // Cheap checks before charging; all of them run again on the fresh copy below.
  const checkSlots = (t: Tournament) => {
    assertOpen(t);
    if (t.teams.length >= t.size) throw new Error("This cup is full.");
    const pending = t.requests.filter((r) => r.status === "pending").length;
    if (t.teams.length + pending >= t.size) throw new Error("This cup has no open slots.");
    assertFree(t, actor.discordId);
    return assertTeamCanEnter(t, team);
  };
  checkSlots(pre);

  return withFee(pre, player.playerName, pre.entryFee, () =>
    mutate(id, (t) => {
      const teamName = checkSlots(t);
      const request: JoinRequest = {
        id: randomUUID(),
        teamId: team.id,
        teamName,
        captainId: actor.discordId,
        captainName: player.username,
        playerName: player.playerName,
        avatar: player.avatar,
        status: "pending",
        paidAmount: pre.entryFee,
        paidBy: player.playerName,
        createdAt: Date.now(),
      };
      t.requests = [
        request,
        ...t.requests.filter((r) => !(r.captainId === actor.discordId && r.status === "denied")),
      ];
    })
  );
}

export async function reviewRequest(
  id: string,
  actor: TournamentActor,
  requestId: string,
  accept: boolean
): Promise<Tournament> {
  const pre = await mustGet(id);
  assertOpen(pre);
  await assertOrganizer(pre, actor);
  const preRequest = pre.requests.find((r) => r.id === requestId && r.status === "pending");
  if (!preRequest) throw new Error("Request not found.");

  if (!accept) {
    return mutate(id, (t) => {
      assertOpen(t);
      const request = t.requests.find((r) => r.id === requestId && r.status === "pending");
      if (!request) throw new Error("Request not found.");
      const paid = Number(request.paidAmount) || 0;
      const paidBy = request.paidBy || "";
      request.status = "denied";
      request.paidAmount = 0;
      if (paid > 0 && paidBy) {
        return {
          coins: [{ key: `cup:${t.id}:reqrefund:${request.id}`, playerName: paidBy, delta: paid, reason: `Entry refused: ${t.name}` }],
        };
      }
    });
  }

  const player = await resolvePlayer(preRequest.playerName);
  if (player.discordId !== preRequest.captainId) {
    throw new Error("That Discord account no longer matches this request.");
  }
  if (preRequest.teamId) {
    const team = await getTeam(preRequest.teamId);
    if (!team || team.captainId !== preRequest.captainId) {
      throw new Error("That team no longer exists or has a new captain. Deny the request instead.");
    }
  }
  if (pre.kind === "community" && pre.clubId) {
    const club = await getClub(pre.clubId);
    if (!club || !club.members.some((m) => m.discordId === player.discordId)) {
      throw new Error("That player is not in the clan.");
    }
  }
  // Requests made before fees were charged up front pay on acceptance.
  const alreadyPaid = preRequest.paidAmount != null;
  const fee = alreadyPaid ? Number(preRequest.paidAmount) || 0 : pre.entryFee;
  const accept_ = (t: Tournament) => {
    assertOpen(t);
    const request = t.requests.find((r) => r.id === requestId && r.status === "pending");
    if (!request) throw new Error("Request not found.");
    if (t.teams.length >= t.size) throw new Error("This cup is full.");
    if (onTeam(t, request.captainId)) {
      throw new Error("That player is already on a team in this cup.");
    }
    t.pot += fee;
    t.teams.push(
      makeTeam({
        name: request.teamName,
        teamId: request.teamId ?? null,
        captainId: player.discordId,
        username: player.username,
        playerName: player.playerName,
        avatar: player.avatar,
        fee,
      })
    );
    t.requests = t.requests.filter((r) => r.id !== request.id);
  };
  if (alreadyPaid) return mutate(id, accept_);
  return withFee(pre, player.playerName, fee, () => mutate(id, accept_));
}

export async function assignCaptain(
  id: string,
  actor: TournamentActor,
  playerName: string,
  teamRef: string
): Promise<Tournament> {
  const pre = await mustGet(id);
  assertOpen(pre);
  if (pre.kind !== "community" || !pre.clubId) {
    throw new Error("Captains are assigned only for clan cups.");
  }
  await assertOrganizer(pre, actor);
  const player = await resolvePlayer(playerName);
  const club = await getClub(pre.clubId);
  if (!club || !club.members.some((m) => m.discordId === player.discordId)) {
    throw new Error("That player is not in this clan.");
  }
  const team = await findCaptainedTeam(player.discordId, teamRef, false);
  const check = (t: Tournament) => {
    assertOpen(t);
    if (t.teams.length >= t.size) throw new Error("This cup is full.");
    assertFree(t, player.discordId);
    return assertTeamCanEnter(t, team);
  };
  check(pre);

  return withFee(pre, player.playerName, pre.entryFee, () =>
    mutate(id, (t) => {
      const teamName = check(t);
      t.pot += pre.entryFee;
      t.teams.push(
        makeTeam({
          name: teamName,
          teamId: team.id,
          captainId: player.discordId,
          username: player.username,
          playerName: player.playerName,
          avatar: player.avatar,
          fee: pre.entryFee,
        })
      );
    })
  );
}

function starterCount(team: TournamentTeam, exceptId?: string) {
  return team.members.filter(
    (m) => m.discordId !== exceptId && (m.role === "captain" || m.role === "starter")
  ).length;
}

function subCount(team: TournamentTeam, exceptId?: string) {
  return team.members.filter((m) => m.discordId !== exceptId && m.role === "sub").length;
}

export async function invitePlayer(
  id: string,
  actor: TournamentActor,
  teamId: string,
  playerName: string
): Promise<Tournament> {
  const pre = await mustGet(id);
  const player = await resolvePlayer(playerName);
  if (player.discordId === actor.discordId) throw new Error("You are already on the team.");
  if (pre.kind === "community" && pre.clubId) {
    const club = await getClub(pre.clubId);
    if (!club || !club.members.some((m) => m.discordId === player.discordId)) {
      throw new Error("Community cups can only invite clan members.");
    }
  }
  return mutate(id, (t) => {
    assertOpen(t);
    const team = t.teams.find((row) => row.id === teamId);
    if (!team || team.captainId !== actor.discordId) {
      throw new Error("Only the team captain can invite.");
    }
    if (team.members.length >= MAX_OTHERS + 1) {
      throw new Error("A roster is 5 starters and 2 subs.");
    }
    assertFree(t, player.discordId);
    let role: RosterRole = "starter";
    if (starterCount(team) >= MAX_STARTERS) {
      if (subCount(team) >= MAX_SUBS) throw new Error("A roster is 5 starters and 2 subs.");
      role = "sub";
    }
    team.members.push({
      discordId: player.discordId,
      username: player.username,
      playerName: player.playerName,
      avatar: player.avatar,
      role,
      status: "invited",
    });
  });
}

export async function respondInvite(
  id: string,
  actor: TournamentActor,
  teamId: string,
  accept: boolean
): Promise<Tournament> {
  return mutate(id, (t) => {
    assertOpen(t);
    const team = t.teams.find((row) => row.id === teamId);
    const member = team?.members.find((m) => m.discordId === actor.discordId && m.status === "invited");
    if (!team || !member) throw new Error("You do not have an invite to that team.");
    if (!accept) {
      team.members = team.members.filter((m) => m.discordId !== actor.discordId);
    } else {
      member.status = "accepted";
    }
  });
}

export async function kickRoster(
  id: string,
  actor: TournamentActor,
  teamId: string,
  discordId: string
): Promise<Tournament> {
  return mutate(id, (t) => {
    assertOpen(t);
    const team = t.teams.find((row) => row.id === teamId);
    if (!team || team.captainId !== actor.discordId) throw new Error("Only the captain can kick.");
    if (discordId === team.captainId) throw new Error("The captain cannot be kicked.");
    if (!team.members.some((m) => m.discordId === discordId)) throw new Error("They are not on this team.");
    team.members = team.members.filter((m) => m.discordId !== discordId);
  });
}

export async function setRosterSlot(
  id: string,
  actor: TournamentActor,
  teamId: string,
  discordId: string,
  slot: string
): Promise<Tournament> {
  return mutate(id, (t) => {
    assertOpen(t);
    const team = t.teams.find((row) => row.id === teamId);
    if (!team || team.captainId !== actor.discordId) throw new Error("Only the captain can set slots.");
    const member = team.members.find((m) => m.discordId === discordId);
    if (!member) throw new Error("They are not on this team.");
    if (member.role === "captain") throw new Error("The captain stays a starter.");
    const role: RosterRole = slot === "sub" ? "sub" : "starter";
    if (role === "starter" && starterCount(team, discordId) >= MAX_STARTERS) {
      throw new Error("Only 5 starters.");
    }
    if (role === "sub" && subCount(team, discordId) >= MAX_SUBS) {
      throw new Error("Only 2 subs.");
    }
    member.role = role;
  });
}

/** Take a team's fee back out of the pot; the returned move pays it back (once). */
function refundTeam(t: Tournament, team: TournamentTeam, reason: string): CoinMove | null {
  if (!(team.paidAmount > 0) || !team.paidBy) return null;
  const move: CoinMove = { key: refundKey(t, team), playerName: team.paidBy, delta: team.paidAmount, reason };
  t.pot = Math.max(0, t.pot - team.paidAmount);
  team.paidAmount = 0;
  return move;
}

export async function withdrawTeam(
  id: string,
  actor: TournamentActor,
  teamId: string
): Promise<Tournament> {
  const pre = await mustGet(id);
  const organizer = await isOrganizer(pre, actor);
  return mutate(id, (t) => {
    assertOpen(t);
    const team = t.teams.find((row) => row.id === teamId);
    if (!team) throw new Error("Team not found.");
    if (team.captainId !== actor.discordId && !organizer) {
      throw new Error("Only the captain or the organizer can withdraw this team.");
    }
    const move = refundTeam(t, team, `Withdrew from ${t.name}`);
    t.teams = t.teams.filter((row) => row.id !== team.id);
    return move ? { coins: [move] } : undefined;
  });
}

async function starterElo(team: TournamentTeam): Promise<number> {
  const starters = team.members.filter(
    (m) => m.status === "accepted" && (m.role === "captain" || m.role === "starter")
  );
  if (!starters.length) return 0;
  let sum = 0;
  for (const member of starters) {
    if (!member.playerName) continue;
    const player = await getPlayer(member.playerName);
    sum += Number(player?.elo ?? 0);
  }
  return sum / starters.length;
}

/**
 * Finish the cup: placements, prize credits (one ledger key per team, so a
 * prize can never be paid twice), pot emptied. Runs inside `mutate`.
 */
function settle(t: Tournament): CoinMove[] {
  if (t.paidOut || !bracketFinished(t.matches, t.bracket)) return [];
  const place = placements(t.matches, t.bracket);
  const [p1, p2] = t.potSplit;
  const firstAmt = Math.floor((t.pot * p1) / 100);
  const secondAmt = Math.floor((t.pot * p2) / 100);
  const thirdAmt = t.pot - firstAmt - secondAmt;
  const rows: { teamId: string; place: number; amount: number }[] = [
    { teamId: place.first, place: 1, amount: firstAmt },
  ];
  if (place.second) rows.push({ teamId: place.second, place: 2, amount: secondAmt });
  else rows[0].amount += secondAmt;
  if (!place.thirds.length) rows[0].amount += thirdAmt;
  else {
    const each = Math.floor(thirdAmt / place.thirds.length);
    const rem = thirdAmt - each * place.thirds.length;
    place.thirds.forEach((teamId, index) => {
      rows.push({ teamId, place: 3, amount: each + (index === 0 ? rem : 0) });
    });
  }
  const moves: CoinMove[] = [];
  for (const row of rows) {
    const team = t.teams.find((item) => item.id === row.teamId);
    if (!team || team.prizeCredited) continue;
    if (row.amount > 0 && team.paidBy) {
      moves.push({
        key: `cup:${t.id}:prize:${team.id}`,
        playerName: team.paidBy,
        delta: row.amount,
        reason: `Prize (#${row.place}): ${t.name}`,
      });
    }
    team.prizeCredited = true;
    team.placement = row.place;
  }
  t.paidOut = true;
  t.pot = 0;
  t.status = "completed";
  return moves;
}

export async function startTournament(id: string, actor: TournamentActor): Promise<Tournament> {
  const pre = await mustGet(id);
  assertOpen(pre);
  await assertOrganizer(pre, actor);
  const elos = new Map(
    await Promise.all(pre.teams.map(async (team) => [team.id, await starterElo(team)] as const))
  );
  return mutate(id, (t) => {
    assertOpen(t);
    if (t.teams.length < 2) throw new Error("Need at least 2 teams to start.");
    if (t.requests.some((r) => r.status === "pending")) {
      throw new Error("Accept or deny pending requests before starting.");
    }
    const ranked = t.teams.map((team) => ({ team, elo: elos.get(team.id) ?? 0 }));
    ranked.sort((a, b) => b.elo - a.elo || a.team.name.localeCompare(b.team.name));
    ranked.forEach((row, index) => {
      row.team.seed = index + 1;
    });
    t.teams = ranked.map((row) => row.team);
    t.matches = createBracket(
      t.teams.map((team) => team.id),
      t.size,
      t.bracket
    );
    t.status = "live";
    if (bracketFinished(t.matches, t.bracket)) return { coins: settle(t) };
  });
}

function cleanScores(t: Tournament, raw: unknown): MapScore[] {
  if (!Array.isArray(raw)) throw new Error("Enter the map scores.");
  const scores: MapScore[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const map = String((row as MapScore).map || "").trim();
    if (!map) continue;
    const scoreA = Number((row as MapScore).scoreA);
    const scoreB = Number((row as MapScore).scoreB);
    if (!t.mapPool.includes(map)) throw new Error(`${map} is not in the map pool.`);
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < 0 ||
      scoreB < 0 ||
      scoreA > 99 ||
      scoreB > 99
    ) {
      throw new Error("Scores must be whole numbers from 0 to 99.");
    }
    if (scoreA === scoreB) throw new Error("A map can't end in a tie.");
    scores.push({ map, scoreA, scoreB });
  }
  if (new Set(scores.map((s) => s.map)).size !== scores.length) {
    throw new Error("Don't repeat a map in the series.");
  }
  const wins = seriesWins(scores);
  if (t.bo === 1) {
    if (scores.length !== 1) throw new Error("BO1 needs one map.");
  } else {
    if (scores.length < 2 || scores.length > 3) throw new Error("BO3 needs 2 or 3 maps.");
    if (Math.max(wins.a, wins.b) < 2) throw new Error("A team needs 2 map wins.");
  }
  return scores;
}

/** The tournament team id this user captains in this match, or null. */
function sideOf(t: Tournament, match: BracketMatch, discordId: string): string | null {
  for (const teamId of [match.teamAId, match.teamBId]) {
    if (!teamId) continue;
    if (t.teams.some((team) => team.id === teamId && team.captainId === discordId)) return teamId;
  }
  return null;
}

function sameScores(a: MapScore[], b: MapScore[]): boolean {
  const key = (s: MapScore[]) => JSON.stringify(s.map((x) => [x.map, x.scoreA, x.scoreB]));
  return key(a) === key(b);
}

/** Final result for a match; finishing the bracket settles the cup. */
function applyScores(t: Tournament, match: BracketMatch, scores: MapScore[]): CoinMove[] {
  const wins = seriesWins(scores);
  const winnerId = wins.a > wins.b ? match.teamAId : match.teamBId;
  if (!winnerId) throw new Error("That match has no winner.");
  applyResult(t.matches, match.id, winnerId, scores);
  match.report = null;
  match.dispute = null;
  return bracketFinished(t.matches, t.bracket) ? settle(t) : [];
}

function liveMatch(t: Tournament, matchId: string): BracketMatch {
  if (t.status !== "live") throw new Error("This cup is not live.");
  const match = t.matches.find((row) => row.id === matchId);
  if (!match) throw new Error("Match not found.");
  if (match.status !== "ready") throw new Error("That match is not ready to be reported.");
  return match;
}

/**
 * Report a result (docs/WEBSITE_SECURITY_PLAN.md 1.4). The organizer — or Match
 * Staff — sets it directly, unless they captain one of the two teams. A playing
 * captain's report waits for the other captain: a matching report or "confirm"
 * makes it final; different scores or "dispute" leave it to the organizer.
 */
export async function reportMatch(
  id: string,
  actor: TournamentActor,
  matchId: string,
  rawScores: unknown
): Promise<Tournament> {
  const pre = await mustGet(id);
  const organizer = await isOrganizer(pre, actor);
  return mutate(id, (t) => {
    const match = liveMatch(t, matchId);
    const scores = cleanScores(t, rawScores);
    const side = sideOf(t, match, actor.discordId);
    if (!side && (organizer || actor.staff)) return { coins: applyScores(t, match, scores) };
    if (!side) throw new Error("Only the organizer or a playing captain can report this match.");
    const theirs = match.report;
    if (theirs && theirs.teamId !== side) {
      if (sameScores(theirs.scores, scores)) return { coins: applyScores(t, match, scores) };
      match.dispute = {
        by: actor.discordId,
        reason: "The captains reported different scores.",
        at: Date.now(),
      };
      return;
    }
    match.report = { teamId: side, by: actor.discordId, scores, at: Date.now() };
    match.dispute = null;
  });
}

/** The other captain accepts the pending report; the result becomes final. */
export async function confirmMatch(
  id: string,
  actor: TournamentActor,
  matchId: string
): Promise<Tournament> {
  return mutate(id, (t) => {
    const match = liveMatch(t, matchId);
    const side = sideOf(t, match, actor.discordId);
    if (!side) throw new Error("Only a captain in this match can confirm.");
    const report = match.report;
    if (!report) throw new Error("There's no reported result to confirm.");
    if (report.teamId === side) throw new Error("The other captain has to confirm your report.");
    return { coins: applyScores(t, match, report.scores) };
  });
}

/** The other captain rejects the pending report; the organizer decides. */
export async function disputeMatch(
  id: string,
  actor: TournamentActor,
  matchId: string,
  reason: string
): Promise<Tournament> {
  return mutate(id, (t) => {
    const match = liveMatch(t, matchId);
    const side = sideOf(t, match, actor.discordId);
    if (!side) throw new Error("Only a captain in this match can dispute.");
    if (!match.report) throw new Error("There's no reported result to dispute.");
    if (match.report.teamId === side) throw new Error("You reported this result — report again to change it.");
    match.dispute = {
      by: actor.discordId,
      reason: reason.trim().slice(0, 300) || "Disputed.",
      at: Date.now(),
    };
  });
}

export async function cancelTournament(id: string, actor: TournamentActor): Promise<Tournament> {
  const pre = await mustGet(id);
  await assertOrganizer(pre, actor);
  return mutate(id, (t) => {
    if (t.status === "completed" || t.status === "cancelled" || t.paidOut) {
      throw new Error("This cup can no longer be cancelled.");
    }
    const moves: CoinMove[] = [];
    for (const request of t.requests) {
      if (request.status !== "pending") continue;
      const paid = Number(request.paidAmount) || 0;
      if (paid > 0 && request.paidBy) {
        moves.push({
          key: `cup:${t.id}:reqrefund:${request.id}`,
          playerName: request.paidBy,
          delta: paid,
          reason: `Cup cancelled: ${t.name}`,
        });
      }
      request.paidAmount = 0;
      request.status = "denied";
    }
    for (const team of t.teams) {
      const move = refundTeam(t, team, `Cup cancelled: ${t.name}`);
      if (move) moves.push(move);
    }
    t.status = "cancelled";
    t.pot = 0;
    return { coins: moves };
  });
}

export function summarizeTournament(t: Tournament) {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    clubId: t.clubId,
    region: t.region,
    bracket: t.bracket,
    size: t.size,
    bo: t.bo,
    entryFee: t.entryFee,
    pot: t.pot,
    potSplit: t.potSplit,
    mapPool: t.mapPool,
    status: t.status,
    teamCount: t.teams.length,
    pendingRequests: t.requests.filter((r) => r.status === "pending").length,
    createdBy: t.createdBy,
    teams: t.teams.map((team) => ({
      id: team.id,
      name: team.name,
      seed: team.seed,
      captainId: team.captainId,
      captainName:
        team.members.find((m) => m.role === "captain")?.playerName ||
        team.members.find((m) => m.role === "captain")?.username ||
        "Captain",
      memberCount: team.members.filter((m) => m.status === "accepted").length,
      placement: team.placement,
    })),
    createdAt: t.createdAt,
  };
}

export function viewerInTournament(t: Tournament, discordId: string | null | undefined): boolean {
  if (!discordId) return false;
  if (t.createdBy === discordId) return true;
  if (t.requests.some((r) => r.captainId === discordId && r.status === "pending")) return true;
  return t.teams.some(
    (team) =>
      team.captainId === discordId ||
      team.members.some((m) => m.discordId === discordId)
  );
}
