/**
 * Find Teammates board (docs/LEAGUE_UI_PLAN.md step 7) for an upcoming season:
 * recruiting posts by team captains, "looking for team" posts by players,
 * applications (captain accepts → the normal team invite) and messages
 * (Discord DM + website notification). Tables live in ensureLeagueSchema.
 */
import { client } from "@/lib/db";
import { addNotification, ensureSocialSchema } from "@/lib/social";
import { getTeam, inviteToTeam, listTeams, type Team } from "@/lib/teams";
import { getEquippedVisualsMap } from "@/lib/cosmetics";
import { cardFromMember, type PlayerCardData } from "@/lib/player-card";
import { openSlot, slotCounts, type RosterSlot } from "@/lib/team-roster";
import { containsProfanity } from "@/lib/content-moderation";
import {
  ACCESS_CODES,
  UPCOMING_STATUSES,
  accessLabel,
  ensureLeagueSchema,
  getSeason,
  openBand,
  seasonEntries,
  teamAccessMap,
  type Season,
  type TeamBadge,
} from "@/lib/league";
import {
  FindInputError,
  MESSAGES_PER_HOUR,
  normalizeMessage,
  normalizePlayerPost,
  normalizeTeamPost,
  type PlayerPostInput,
  type TeamPostInput,
} from "@/lib/league-find-rules";

export { FindInputError };

const HOUR_MS = 3_600_000;

export interface Viewer {
  discordId: string;
  playerName: string | null;
  username: string;
  avatar: string | null;
}

export interface TeamPostView extends TeamPostInput {
  id: number;
  team: TeamBadge;
  /** Access / Open band code of the team, e.g. "main" or "open57". */
  division: string;
  divisionLabel: string;
  inviteOnly: boolean;
  members: number;
  starters: number;
  subs: number;
  /** The roster as cards (D2): main roster (captain first), subs, coach. */
  roster: { starters: PlayerCardData[]; subs: PlayerCardData[]; coach: PlayerCardData | null };
  /** Slots taken (accepted + invited) per slot. */
  slots: Record<RosterSlot, number>;
  /** The team's most common player country. */
  country: string | null;
  /** A main-roster or sub slot is free (lib/team-roster.ts). */
  joinable: boolean;
  signedUp: boolean;
  /** Average main Elo of the best 5 (unranked = 1200); null with no linked players. */
  seedElo: number | null;
  open: boolean;
  updatedAt: number;
  mine: boolean;
  /** The viewer's application to this team, if any. */
  applied: ApplicationStatus | null;
}

export interface PlayerPostView extends PlayerPostInput {
  id: number;
  discordId: string;
  playerName: string;
  elo: number | null;
  rank: string | null;
  country: string | null;
  avatar: string | null;
  /** On a team signed up for this season already. */
  signedUpWith: string | null;
  /** The FACEIT-style card (D3). */
  card: PlayerCardData;
  open: boolean;
  updatedAt: number;
  mine: boolean;
}

export type ApplicationStatus = "pending" | "accepted" | "declined" | "withdrawn";

export interface ApplicationView {
  id: number;
  teamId: string;
  teamName: string;
  discordId: string;
  playerName: string;
  message: string | null;
  status: ApplicationStatus;
  createdAt: number;
  elo: number | null;
}

function fail(msg: string): never {
  throw new FindInputError(msg);
}

const arr = (v: unknown): string[] => {
  try {
    const out = JSON.parse(String(v ?? "[]"));
    return Array.isArray(out) ? out.map(String) : [];
  } catch {
    return [];
  }
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
type Row = Record<string, unknown>;

/** The season the board belongs to: upcoming (draft or sign-ups) only. */
async function boardSeason(seasonId: number): Promise<Season> {
  await ensureLeagueSchema();
  const season = await getSeason(seasonId);
  if (!season) fail("Season not found.");
  if (!UPCOMING_STATUSES.includes(season.status)) fail("Recruiting is closed for this season.");
  return season;
}

function clean(text: string | null): void {
  if (text && containsProfanity(text)) fail("Please keep it friendly — that text isn't allowed.");
}

/** Players (main Elo, rank, country, avatar) by lower-cased name; tolerant of missing columns. */
async function playerInfo(names: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const uniq = [...new Set(names.filter(Boolean).map((n) => n.toLowerCase()))];
  if (!uniq.length) return out;
  const rs = await client
    .execute({
      sql: `SELECT * FROM players WHERE LOWER(name) IN (${uniq.map(() => "?").join(",")})`,
      args: uniq,
    })
    .catch(() => ({ rows: [] as Row[] }));
  for (const r of rs.rows as Row[]) out.set(String(r.name).toLowerCase(), r);
  return out;
}

const eloOf = (r: Row | undefined) =>
  r && Number(r.placement_done ?? 1) === 1 && Number(r.elo) > 0 ? Number(r.elo) : null;

/** Equipped profile cards by player name (banner art); empty if cosmetics aren't set up. */
async function cardArt(): Promise<Map<string, { card: string | null }>> {
  return getEquippedVisualsMap().catch(() => new Map<string, { card: string | null }>());
}

/** The most common country among these players (ties: first seen). */
function commonCountry(rows: (Row | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r?.country ? String(r.country).toLowerCase() : null;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [c, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = c;
  return best;
}

/** A team's roster as cards: main roster (captain first, then by Elo), subs by Elo, coach. */
function rosterCards(team: Team, info: Map<string, Row>, art: Map<string, { card: string | null }>) {
  const accepted = team.members.filter((m) => m.status === "accepted");
  const card = (m: Team["members"][number]) =>
    cardFromMember(m, {
      row: m.playerName ? info.get(m.playerName.toLowerCase()) : undefined,
      tag: team.tag,
      captainId: team.captainId,
      cardArt: m.playerName ? art.get(m.playerName)?.card ?? null : null,
    });
  const byElo = (a: PlayerCardData, b: PlayerCardData) => Number(b.captain) - Number(a.captain) || (b.elo ?? -1) - (a.elo ?? -1);
  return {
    starters: accepted.filter((m) => m.role === "captain" || m.role === "starter").map(card).sort(byElo),
    subs: accepted.filter((m) => m.role === "sub").map(card).sort(byElo),
    coach: accepted.filter((m) => m.role === "coach").map(card)[0] ?? null,
  };
}

function teamSeedElo(team: Team, info: Map<string, Row>): number | null {
  const names = team.members.filter((m) => m.status === "accepted" && m.playerName).map((m) => m.playerName!);
  if (!names.length) return null;
  const elos = names
    .map((n) => eloOf(info.get(n.toLowerCase())) ?? 1200)
    .sort((a, b) => b - a)
    .slice(0, 5);
  return Math.round(elos.reduce((s, e) => s + e, 0) / elos.length);
}

function badge(t: Team): TeamBadge {
  return { id: t.id, name: t.name, tag: t.tag, logoUrl: t.logoUrl, accentColor: t.accentColor };
}

// --- notify ------------------------------------------------------------------------------

async function dm(discordId: string | null, message: string): Promise<void> {
  if (!discordId) return;
  await ensureSocialSchema();
  await client.execute({
    sql: "INSERT INTO discord_dm_outbox (discord_id, message, sent, created_at) VALUES (?, ?, 0, ?)",
    args: [discordId, message, Date.now()],
  });
}

/** Website bell (type "league", refId = the page to open) + Discord DM. */
async function notify(
  to: { discordId: string | null; playerName: string | null },
  message: string,
  path: string,
  actorName: string | null = null
): Promise<void> {
  if (to.playerName) await addNotification(to.playerName, "league", message, actorName, path);
  await dm(to.discordId, `${message}\n${siteUrl(path)}`);
}

function siteUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

const findPath = (seasonId: number, tab = "teams") => `/league/${seasonId}/find?tab=${tab}`;

function captainOf(team: Team): { discordId: string; playerName: string | null } {
  const m = team.members.find((x) => x.discordId === team.captainId);
  return { discordId: team.captainId, playerName: m?.playerName ?? team.captainName ?? null };
}

// --- team posts ----------------------------------------------------------------------------

export async function saveTeamPost(seasonId: number, teamId: string, viewer: Viewer, raw: Record<string, unknown>) {
  await boardSeason(seasonId);
  const team = await getTeam(teamId);
  if (!team) fail("Team not found.");
  if (team.captainId !== viewer.discordId) fail("Only the team captain can post for the team.");
  const input = normalizeTeamPost(raw);
  clean(`${input.title} ${input.body ?? ""}`);
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO league_team_posts
            (season_id, team_id, author_id, title, body, roles, days, times, language, min_elo, max_elo, open, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (season_id, team_id) DO UPDATE SET
            author_id = excluded.author_id, title = excluded.title, body = excluded.body,
            roles = excluded.roles, days = excluded.days, times = excluded.times,
            language = excluded.language, min_elo = excluded.min_elo, max_elo = excluded.max_elo,
            open = 1, updated_at = excluded.updated_at`,
    args: [
      seasonId, teamId, viewer.discordId, input.title, input.body,
      JSON.stringify(input.roles), JSON.stringify(input.days), JSON.stringify(input.times),
      input.language, input.minElo, input.maxElo, now, now,
    ],
  });
}

/** Captain removes the team's post; pending applications to it are withdrawn. */
export async function deleteTeamPost(seasonId: number, teamId: string, viewer: Viewer) {
  await ensureLeagueSchema();
  const team = await getTeam(teamId);
  if (!team || team.captainId !== viewer.discordId) fail("Only the team captain can remove the post.");
  await client.execute({ sql: "DELETE FROM league_team_posts WHERE season_id = ? AND team_id = ?", args: [seasonId, teamId] });
  await client.execute({
    sql: "UPDATE league_applications SET status = 'withdrawn', decided_at = ? WHERE season_id = ? AND team_id = ? AND status = 'pending'",
    args: [Date.now(), seasonId, teamId],
  });
}

export async function listTeamPosts(seasonId: number, viewerId: string | null): Promise<TeamPostView[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT * FROM league_team_posts WHERE season_id = ? AND open = 1 ORDER BY updated_at DESC",
    args: [seasonId],
  });
  const rows = rs.rows as Row[];
  if (!rows.length) return [];
  const teams = new Map((await listTeams()).map((t) => [t.id, t]));
  const entries = new Set((await seasonEntries(seasonId)).filter((e) => e.status !== "ineligible").map((e) => e.teamId));
  const access = await teamAccessMap(rows.map((r) => String(r.team_id)));
  const info = await playerInfo(
    rows.flatMap((r) => teams.get(String(r.team_id))?.members.map((m) => m.playerName ?? "") ?? [])
  );
  const art = await cardArt();
  const mineApps = new Map<string, ApplicationStatus>();
  if (viewerId) {
    const apps = await client.execute({
      sql: "SELECT team_id, status FROM league_applications WHERE season_id = ? AND discord_id = ?",
      args: [seasonId, viewerId],
    });
    for (const a of apps.rows as Row[]) mineApps.set(String(a.team_id), String(a.status) as ApplicationStatus);
  }

  const out: TeamPostView[] = [];
  for (const r of rows) {
    const team = teams.get(String(r.team_id));
    if (!team) continue; // team deleted since
    const seed = teamSeedElo(team, info);
    const code = access.get(team.id) ?? null;
    const division = code && ACCESS_CODES.includes(code) ? code : openBand(seed);
    const accepted = team.members.filter((m) => m.status === "accepted");
    out.push({
      id: Number(r.id),
      team: badge(team),
      division,
      divisionLabel: accessLabel(code, seed),
      inviteOnly: code !== null,
      members: accepted.length,
      starters: accepted.filter((m) => m.role === "captain" || m.role === "starter").length,
      subs: accepted.filter((m) => m.role === "sub").length,
      roster: rosterCards(team, info, art),
      slots: slotCounts(team.members),
      country: commonCountry(accepted.map((m) => (m.playerName ? info.get(m.playerName.toLowerCase()) : undefined))),
      joinable: openSlot(team.members) !== null,
      signedUp: entries.has(team.id),
      seedElo: seed,
      title: String(r.title),
      body: r.body == null ? null : String(r.body),
      roles: arr(r.roles),
      days: arr(r.days),
      times: arr(r.times),
      language: r.language == null ? null : String(r.language),
      minElo: num(r.min_elo),
      maxElo: num(r.max_elo),
      open: Number(r.open) === 1,
      updatedAt: Number(r.updated_at),
      mine: !!viewerId && team.captainId === viewerId,
      applied: mineApps.get(team.id) ?? null,
    });
  }
  return out;
}

// --- player posts --------------------------------------------------------------------------

export async function savePlayerPost(seasonId: number, viewer: Viewer, raw: Record<string, unknown>) {
  await boardSeason(seasonId);
  if (!viewer.playerName) fail("Link your HyperLeague player first (log in with the Discord account you play with).");
  const input = normalizePlayerPost(raw);
  clean(`${input.title} ${input.body ?? ""}`);
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO league_player_posts
            (season_id, discord_id, player_name, title, body, roles, days, times, language, divisions, open, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (season_id, discord_id) DO UPDATE SET
            player_name = excluded.player_name, title = excluded.title, body = excluded.body,
            roles = excluded.roles, days = excluded.days, times = excluded.times,
            language = excluded.language, divisions = excluded.divisions,
            open = 1, updated_at = excluded.updated_at`,
    args: [
      seasonId, viewer.discordId, viewer.playerName, input.title, input.body,
      JSON.stringify(input.roles), JSON.stringify(input.days), JSON.stringify(input.times),
      input.language, JSON.stringify(input.divisions), now, now,
    ],
  });
}

export async function deletePlayerPost(seasonId: number, viewer: Viewer) {
  await ensureLeagueSchema();
  await client.execute({
    sql: "DELETE FROM league_player_posts WHERE season_id = ? AND discord_id = ?",
    args: [seasonId, viewer.discordId],
  });
}

export async function listPlayerPosts(seasonId: number, viewerId: string | null): Promise<PlayerPostView[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT * FROM league_player_posts WHERE season_id = ? AND open = 1 ORDER BY updated_at DESC",
    args: [seasonId],
  });
  const rows = rs.rows as Row[];
  if (!rows.length) return [];
  const info = await playerInfo(rows.map((r) => String(r.player_name)));
  const art = await cardArt();
  const signed = new Map<string, string>();
  for (const e of await seasonEntries(seasonId)) {
    if (e.status === "ineligible") continue;
    for (const p of e.roster) signed.set(p.discordId, e.teamName);
  }
  return rows.map((r) => {
    const p = info.get(String(r.player_name).toLowerCase());
    return {
      id: Number(r.id),
      discordId: String(r.discord_id),
      playerName: String(r.player_name),
      elo: eloOf(p),
      rank: p?.rank == null ? null : String(p.rank),
      country: p?.country == null ? null : String(p.country).toLowerCase(),
      avatar: (p?.roblox_avatar_image ?? p?.discord_avatar ?? null) as string | null,
      signedUpWith: signed.get(String(r.discord_id)) ?? null,
      card: cardFromMember(
        { discordId: String(r.discord_id), username: String(r.player_name), playerName: String(r.player_name), avatar: null, role: "starter" },
        { row: p, viewerId, cardArt: art.get(String(r.player_name))?.card ?? null }
      ),
      title: String(r.title),
      body: r.body == null ? null : String(r.body),
      roles: arr(r.roles),
      days: arr(r.days),
      times: arr(r.times),
      language: r.language == null ? null : String(r.language),
      divisions: arr(r.divisions),
      open: Number(r.open) === 1,
      updatedAt: Number(r.updated_at),
      mine: viewerId === String(r.discord_id),
    };
  });
}

// --- applications --------------------------------------------------------------------------

export async function applyToTeam(seasonId: number, teamId: string, viewer: Viewer, rawMessage: unknown) {
  const season = await boardSeason(seasonId);
  if (!viewer.playerName) fail("Link your HyperLeague player first (log in with the Discord account you play with).");
  const post = await client.execute({
    sql: "SELECT id FROM league_team_posts WHERE season_id = ? AND team_id = ? AND open = 1",
    args: [seasonId, teamId],
  });
  if (!post.rows.length) fail("This team isn't recruiting any more.");
  const team = await getTeam(teamId);
  if (!team) fail("Team not found.");
  if (team.members.some((m) => m.discordId === viewer.discordId)) fail("You're already on this team (or invited to it).");
  if (!openSlot(team.members)) fail("This team is full.");
  const message = rawMessage ? String(rawMessage).trim().slice(0, 400) || null : null;
  clean(message);

  const prev = await client.execute({
    sql: "SELECT status FROM league_applications WHERE season_id = ? AND team_id = ? AND discord_id = ?",
    args: [seasonId, teamId, viewer.discordId],
  });
  const prevStatus = prev.rows[0] ? String((prev.rows[0] as Row).status) : null;
  if (prevStatus === "pending") fail("You already applied — wait for the captain.");
  if (prevStatus === "declined") fail("The captain declined your application to this team.");
  if (prevStatus === "accepted") fail("You were already accepted — check your team invites.");
  await client.execute({
    sql: `INSERT INTO league_applications (season_id, team_id, discord_id, player_name, username, avatar, message, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
          ON CONFLICT (season_id, team_id, discord_id) DO UPDATE SET
            message = excluded.message, status = 'pending', created_at = excluded.created_at,
            decided_at = NULL, decided_by = NULL`,
    args: [seasonId, teamId, viewer.discordId, viewer.playerName, viewer.username, viewer.avatar, message, Date.now()],
  });
  await notify(
    captainOf(team),
    `${viewer.playerName} applied to join ${team.name} for ${season.name}.` + (message ? ` "${message}"` : ""),
    findPath(seasonId),
    viewer.playerName
  );
}

export async function withdrawApplication(applicationId: number, viewer: Viewer) {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "UPDATE league_applications SET status = 'withdrawn', decided_at = ? WHERE id = ? AND discord_id = ? AND status = 'pending'",
    args: [Date.now(), applicationId, viewer.discordId],
  });
  if (!rs.rowsAffected) fail("No pending application to withdraw.");
}

/** Captain: accept (→ team invite for the player) or decline an application. */
export async function decideApplication(applicationId: number, viewer: Viewer, accept: boolean) {
  await ensureLeagueSchema();
  const rs = await client.execute({ sql: "SELECT * FROM league_applications WHERE id = ?", args: [applicationId] });
  const app = rs.rows[0] as Row | undefined;
  if (!app) fail("Application not found.");
  const team = await getTeam(String(app.team_id));
  if (!team) fail("Team not found.");
  if (team.captainId !== viewer.discordId) fail("Only the team captain can answer applications.");
  if (String(app.status) !== "pending") fail("This application was already answered.");
  const seasonId = Number(app.season_id);
  const season = await getSeason(seasonId);

  if (accept) {
    // Throws (full team, already a member…) before the application changes.
    await inviteToTeam(team.id, viewer.discordId, {
      discordId: String(app.discord_id),
      username: String(app.username || app.player_name),
      playerName: String(app.player_name),
      avatar: app.avatar == null ? null : String(app.avatar),
    });
  }
  // Status guard: a double click or a second tab can't answer twice.
  const upd = await client.execute({
    sql: "UPDATE league_applications SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'",
    args: [accept ? "accepted" : "declined", Date.now(), viewer.discordId, applicationId],
  });
  if (!upd.rowsAffected) fail("This application was already answered.");
  const to = { discordId: String(app.discord_id), playerName: String(app.player_name) };
  if (accept) {
    await notify(
      to,
      `${team.name} accepted your application for ${season?.name ?? "the league"}! Accept the team invite on the team page to join.`,
      `/teams/${team.id}`,
      captainOf(team).playerName
    );
  } else {
    await notify(to, `${team.name} declined your application for ${season?.name ?? "the league"}.`, findPath(seasonId));
  }
}

// --- messages ------------------------------------------------------------------------------

/** Message a player about their post: Discord DM + website notification. Rate limited. */
export async function messagePlayer(seasonId: number, postId: number, viewer: Viewer, raw: unknown, now = Date.now()) {
  const season = await boardSeason(seasonId);
  if (!viewer.playerName) fail("Link your HyperLeague player first.");
  const text = normalizeMessage(raw);
  clean(text);
  const rs = await client.execute({
    sql: "SELECT discord_id, player_name FROM league_player_posts WHERE id = ? AND season_id = ? AND open = 1",
    args: [postId, seasonId],
  });
  const post = rs.rows[0] as Row | undefined;
  if (!post) fail("This post isn't up any more.");
  if (String(post.discord_id) === viewer.discordId) fail("That's your own post.");
  await ensureSocialSchema();
  const sent = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM notifications WHERE type = 'league_message' AND actor_name = ? AND created_at > ?",
    args: [viewer.playerName, now - HOUR_MS],
  });
  if (Number((sent.rows[0] as Row)?.c ?? 0) >= MESSAGES_PER_HOUR) {
    fail(`You can send ${MESSAGES_PER_HOUR} messages an hour from the board. Try again later.`);
  }
  // Which team is writing? The sender's captained team, if any (helps the reader).
  const teams = (await listTeams()).filter((t) => t.captainId === viewer.discordId);
  const from = teams.length === 1 ? `${viewer.playerName} (captain of ${teams[0].name})` : viewer.playerName;
  const message = `${from} messaged you about your ${season.name} Find Teammates post: "${text}"`;
  await addNotification(String(post.player_name), "league_message", message, viewer.playerName, findPath(seasonId, "players"));
  await dm(String(post.discord_id), `${message}\nReply to them on Discord (@${viewer.username}).`);
}

// --- the viewer's own recruiting ------------------------------------------------------------

export interface MyRecruiting {
  captainTeams: { team: TeamBadge; post: TeamPostView | null; applications: ApplicationView[] }[];
  playerPost: PlayerPostView | null;
  myApplications: ApplicationView[];
  linked: boolean;
}

function toApplication(r: Row, teamName: string, elo: number | null): ApplicationView {
  return {
    id: Number(r.id),
    teamId: String(r.team_id),
    teamName,
    discordId: String(r.discord_id),
    playerName: String(r.player_name),
    message: r.message == null ? null : String(r.message),
    status: String(r.status) as ApplicationStatus,
    createdAt: Number(r.created_at),
    elo,
  };
}

export async function myRecruiting(
  seasonId: number,
  viewer: Viewer,
  posts?: { teams: TeamPostView[]; players: PlayerPostView[] }
): Promise<MyRecruiting> {
  await ensureLeagueSchema();
  const all = await listTeams();
  const byId = new Map(all.map((t) => [t.id, t]));
  const captained = all.filter((t) => t.captainId === viewer.discordId);
  const teamPosts = posts?.teams ?? (await listTeamPosts(seasonId, viewer.discordId));
  const playerPosts = posts?.players ?? (await listPlayerPosts(seasonId, viewer.discordId));

  const incoming = captained.length
    ? ((
        await client.execute({
          sql: `SELECT * FROM league_applications WHERE season_id = ? AND status = 'pending'
                AND team_id IN (${captained.map(() => "?").join(",")}) ORDER BY created_at`,
          args: [seasonId, ...captained.map((t) => t.id)],
        })
      ).rows as Row[])
    : [];
  const mine = (
    await client.execute({
      sql: "SELECT * FROM league_applications WHERE season_id = ? AND discord_id = ? ORDER BY created_at DESC",
      args: [seasonId, viewer.discordId],
    })
  ).rows as Row[];
  const info = await playerInfo(incoming.map((r) => String(r.player_name)));

  return {
    captainTeams: captained.map((t) => ({
      team: badge(t),
      post: teamPosts.find((p) => p.team.id === t.id) ?? null,
      applications: incoming
        .filter((r) => String(r.team_id) === t.id)
        .map((r) => toApplication(r, t.name, eloOf(info.get(String(r.player_name).toLowerCase())))),
    })),
    playerPost: playerPosts.find((p) => p.discordId === viewer.discordId) ?? null,
    myApplications: mine.map((r) => toApplication(r, byId.get(String(r.team_id))?.name ?? "Deleted team", null)),
    linked: !!viewer.playerName,
  };
}

/** Open posts on the board (the hero's FIND TEAMMATES count). */
export async function findCount(seasonId: number): Promise<number> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: `SELECT (SELECT COUNT(*) FROM league_team_posts WHERE season_id = ? AND open = 1)
               + (SELECT COUNT(*) FROM league_player_posts WHERE season_id = ? AND open = 1) AS c`,
    args: [seasonId, seasonId],
  });
  return Number((rs.rows[0] as Row)?.c ?? 0);
}
