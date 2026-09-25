/**
 * Team League staff actions on the website: run a season without Discord
 * commands (create → open sign-ups → close & draw → move teams → start, cancel,
 * remove a sign-up, the league channel), plus the Manage tab's data.
 *
 * The division draw and the round-robin are ported from the bot's
 * core/league.py. Both sides check the same examples in
 * tests/league-vectors.json (regenerate with `python -m tests.league_vectors
 * --write` in the bot repo), so the two copies can't drift apart.
 *
 * Every season step only applies if the season is still where the page saw it
 * (the bot's /league commands may have got there first). Staff actions are
 * written to league_events; the bot's league loop posts the big steps in the
 * league channel.
 */
import { client } from "@/lib/db";
import {
  DIVISION_NAMES,
  STATUS_CODES,
  DIVISION_ORDER,
  LIVE_STATUSES,
  UPCOMING_STATUSES,
  ensureLeagueSchema,
  getSeason,
  openBand,
  teamAccessMap,
  listSeasons,
  rosterFromTeam,
  seasonDivisions,
  seasonEntries,
  seasonMatches,
  seedElo,
  type Entry,
  type RosterPlayer,
  type Season,
  type SeasonStatus,
} from "@/lib/league";
import { getTeam } from "@/lib/teams";
import { CONFERENCE_MAX, conferenceSizes, firstRound, formatFor, type DivisionFormat } from "@/lib/league-swiss";

/** Smaller divisions merge with the next one down. Conferences: at most CONFERENCE_MAX (lib/league-swiss.ts). */
export const DIVISION_MIN = 4;
export const SEASON_WEEKS = 6;
export const BO_REGULAR = 1;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const LEAGUE_CHANNEL_KEY = "league_channel_id";
const OPEN_STATUSES: SeasonStatus[] = ["draft", "signup", "drawn", "regular", "playoffs"];

export interface Actor {
  discordId: string;
  name: string;
}

export class LeagueAdminError extends Error {}
const fail = (message: string): never => {
  throw new LeagueAdminError(message);
};

// --- pure rules (same as core/league.py) ------------------------------------------------------

/** Single round-robin rounds (circle method); odd counts get a bye each round. */
export function roundRobin(teamIds: string[]): [string, string][][] {
  let teams: (string | null)[] = [...teamIds];
  if (teams.length % 2) teams.push(null);
  const n = teams.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      if (a === null || b === null) continue;
      pairs.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    teams = [teams[0], teams[n - 1], ...teams.slice(1, n - 1)];
  }
  return rounds;
}

/** [week, team A, team B] for a division (double round-robin when it fits). */
export function seasonSchedule(teamIds: string[], weeks = SEASON_WEEKS): [number, string, string][] {
  let rounds = roundRobin(teamIds);
  if (2 * rounds.length <= weeks) {
    rounds = [...rounds, ...rounds.map((rnd) => rnd.map(([a, b]) => [b, a] as [string, string]))];
  }
  const out: [number, string, string][] = [];
  rounds.forEach((rnd, i) => {
    const week = Math.min(i + 1, weeks);
    for (const [a, b] of rnd) out.push([week, a, b]);
  });
  return out;
}

/** 00:00 UTC of the first Monday strictly after `after`. */
export function nextMonday(after: number): number {
  const d = new Date(after);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  return day + ((7 - weekday) % 7 || 7) * DAY;
}

/** 'YYYY-MM-DD' → that Monday (or the next Monday after it), 00:00 UTC; empty → next Monday. */
export function parseFirstWeek(text: string | null | undefined, now = Date.now()): number {
  const raw = (text ?? "").trim();
  if (!raw) return nextMonday(now);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const day = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!m || Number.isNaN(day) || new Date(day).getUTCDate() !== Number(m[3])) {
    fail("Use the date format YYYY-MM-DD, e.g. 2026-10-05.");
  }
  const monday = (new Date(day).getUTCDay() + 6) % 7 === 0 ? day : nextMonday(day);
  if (monday < now - DAY) fail("Week 1 can't start in the past.");
  return monday;
}

/** Strongest first: seed Elo, then who signed up first. */
export function drawOrder<T extends { seedElo: number | null; signedUpAt: number; id: number }>(items: T[]): T[] {
  return [...items].sort(
    (x, y) => (y.seedElo ?? 0) - (x.seedElo ?? 0) || x.signedUpAt - y.signedUpAt || x.id - y.id
  );
}

type Seeded = { teamId: string; seedElo: number | null; signedUpAt: number; id: number };

export interface PlannedDivision<T> {
  name: string;
  /** "main", "open57", merged "pro+advanced" */
  code: string;
  teams: T[];
  /** "rr" up to 7 teams, else "swiss". */
  format: DivisionFormat;
}

/** Deal strongest-first teams into groups in a snake (1,2,3,3,2,1,...) so groups are even. */
function snake<T>(teams: T[], sizes: number[]): T[][] {
  const groups: T[][] = sizes.map(() => []);
  const order = sizes.map((_, i) => i);
  const pattern = [...order, ...[...order].reverse()];
  let i = 0;
  for (const e of teams) {
    for (;;) {
      const g = pattern[i % pattern.length];
      i += 1;
      if (groups[g].length < sizes[g]) {
        groups[g].push(e);
        break;
      }
    }
  }
  return groups;
}

/**
 * Place teams (same as core/league.py plan_divisions): division by the team's
 * status (access), else its Open skill band. A division with fewer than 4 teams
 * plays together with the next one down ("Pro/Advanced"); the last one merges
 * up instead. A division with more than 32 teams splits into even conferences
 * ("Main A", "Main B"). Up to 7 teams play a round-robin, more play Swiss.
 */
export function planDivisions<T extends Seeded>(eligible: T[], access: Record<string, string> = {}): PlannedDivision<T>[] {
  if (eligible.length < DIVISION_MIN) fail(`At least ${DIVISION_MIN} eligible teams are needed (have ${eligible.length}).`);
  const buckets = new Map<string, T[]>(DIVISION_ORDER.map(([code]) => [code, []]));
  for (const e of eligible) {
    const code = access[e.teamId];
    buckets.get(code && STATUS_CODES.includes(code) ? code : openBand(e.seedElo))!.push(e);
  }
  type Level = { codes: string[]; names: string[]; teams: T[] };
  const levels: Level[] = [...buckets.entries()]
    .filter(([, teams]) => teams.length)
    .map(([code, teams]) => ({ codes: [code], names: [DIVISION_NAMES[code]], teams: drawOrder(teams) }));
  const combine = (a: Level, b: Level): Level => ({
    codes: [...a.codes, ...b.codes],
    names: [...a.names, ...b.names],
    teams: drawOrder([...a.teams, ...b.teams]),
  });
  const merged: Level[] = [];
  let carry: Level | null = null;
  for (let lvl of levels) {
    if (carry) {
      lvl = combine(carry, lvl);
      carry = null;
    }
    if (lvl.teams.length < DIVISION_MIN) {
      carry = lvl;
      continue;
    }
    merged.push(lvl);
  }
  if (carry) merged[merged.length - 1] = combine(merged[merged.length - 1], carry);

  const out: PlannedDivision<T>[] = [];
  for (const { codes, names, teams } of merged) {
    const name = names.join("/");
    const code = codes.join("+");
    if (teams.length <= CONFERENCE_MAX) {
      out.push({ name, code, teams, format: formatFor(teams.length) });
      continue;
    }
    snake(teams, conferenceSizes(teams.length)).forEach((group, i) => {
      out.push({ name: `${name} ${String.fromCharCode(65 + i)}`, code, teams: drawOrder(group), format: formatFor(group.length) });
    });
  }
  return out;
}

/** Give a team access to a named division, or take it away (null → Open by skill). */
export async function setTeamAccess(teamId: string, access: string | null, actor: Actor): Promise<void> {
  await ensureLeagueSchema();
  if (access !== null && !STATUS_CODES.includes(access)) fail("Unknown division access.");
  const team = await getTeam(teamId);
  if (!team) fail("Team not found.");
  if (access === null) {
    await client.execute({ sql: "DELETE FROM league_team_access WHERE team_id = ?", args: [teamId] });
  } else {
    await client.execute({
      sql: `INSERT OR REPLACE INTO league_team_access (team_id, access, set_by, set_by_id, set_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [teamId, access, actor.name, actor.discordId, Date.now()],
    });
  }
  const label = access ? `${DIVISION_NAMES[access]} Access` : "Open (plays in its skill band)";
  await logEvent(null, "access_set", actor, `${team!.name} → ${label}`);
}

/** Season page details (banner, description, rules, notice) — Match Staff. */
export async function updateSeasonDetails(
  seasonId: number,
  details: { name?: string; bannerUrl?: string | null; description?: string | null; rules?: string | null; notice?: string | null },
  actor: Actor
): Promise<void> {
  const season = await seasonOrFail(seasonId);
  const text = (v: string | null | undefined, max: number) => {
    const t = (v ?? "").trim().slice(0, max);
    return t ? t : null;
  };
  const banner = text(details.bannerUrl, 500);
  if (banner && !/^https:\/\//i.test(banner)) fail("The banner must be an https:// image link.");
  const name = details.name === undefined ? season.name : details.name.split(/\s+/).join(" ").trim().slice(0, 40);
  if (!name) fail("The season needs a name.");
  await client.execute({
    sql: `UPDATE league_seasons SET name = ?, banner_url = ?, description = ?, rules = ?, notice = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      name,
      details.bannerUrl === undefined ? season.bannerUrl ?? null : banner,
      details.description === undefined ? season.description ?? null : text(details.description, 4000),
      details.rules === undefined ? season.rules ?? null : text(details.rules, 20000),
      details.notice === undefined ? season.notice ?? null : text(details.notice, 500),
      Date.now(),
      season.id,
    ],
  });
  await logEvent(season.id, "details_updated", actor, name);
}

// --- events -------------------------------------------------------------------------------------

/** Season steps the bot posts in the league channel (same list as core/league.py). */
const ANNOUNCED_EVENTS = new Set([
  "signups_opened",
  "divisions_drawn",
  "season_started",
  "season_cancelled",
  "playoffs_started",
  "season_finished",
]);

export async function logEvent(
  seasonId: number | null,
  kind: string,
  actor: Actor,
  detail = "",
  matchId: number | null = null
): Promise<void> {
  await ensureLeagueSchema();
  await client.execute({
    sql: `INSERT INTO league_events (season_id, match_id, kind, actor_id, actor_name, source, detail, announced, created_at)
          VALUES (?, ?, ?, ?, ?, 'website', ?, ?, ?)`,
    args: [seasonId, matchId, kind, actor.discordId, actor.name, detail, ANNOUNCED_EVENTS.has(kind) ? 0 : 1, Date.now()],
  });
}

export async function listEvents(seasonId: number | null, limit = 40) {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: `SELECT id, season_id, match_id, kind, actor_name, source, detail, created_at FROM league_events
          WHERE season_id = ? OR season_id IS NULL ORDER BY id DESC LIMIT ?`,
    args: [seasonId, limit],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    matchId: r.match_id == null ? null : Number(r.match_id),
    kind: String(r.kind),
    actor: r.actor_name == null ? null : String(r.actor_name),
    source: String(r.source ?? "discord"),
    detail: String(r.detail ?? ""),
    createdAt: Number(r.created_at),
  }));
}

// --- season steps -------------------------------------------------------------------------------

/** Move a season to `status` only if it's still in one of `from`. */
export async function claim(
  seasonId: number,
  from: SeasonStatus[],
  status: SeasonStatus,
  cols: Record<string, number | string | null> = {}
): Promise<boolean> {
  const keys = Object.keys(cols);
  const rs = await client.execute({
    sql: `UPDATE league_seasons SET status = ?, updated_at = ?${keys.map((k) => `, ${k} = ?`).join("")}
          WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
    args: [status, Date.now(), ...keys.map((k) => cols[k]), seasonId, ...from],
  });
  return rs.rowsAffected > 0;
}

async function seasonOrFail(seasonId: number): Promise<Season> {
  const season = await getSeason(seasonId);
  if (!season) fail("Season not found.");
  return season!;
}

export async function createSeason(name: string, actor: Actor): Promise<Season> {
  await ensureLeagueSchema();
  const seasons = await listSeasons();
  const upcoming = seasons.find((s) => UPCOMING_STATUSES.includes(s.status));
  if (upcoming) fail(`${upcoming.name} is already being set up. Cancel it first.`);
  const clean = name.split(/\s+/).join(" ").trim().slice(0, 40) || `Season ${seasons.length + 1}`;
  const now = Date.now();
  const rs = await client.execute({
    sql: `INSERT INTO league_seasons (name, status, weeks, created_by, created_at, updated_at)
          VALUES (?, 'draft', ?, ?, ?, ?)`,
    args: [clean, SEASON_WEEKS, actor.name, now, now],
  });
  const id = Number(rs.lastInsertRowid);
  // Two staff creating at the same moment: keep the first upcoming season only.
  const running = (await listSeasons()).filter((s) => UPCOMING_STATUSES.includes(s.status));
  if (running.some((s) => s.id < id)) {
    await client.execute({ sql: "DELETE FROM league_seasons WHERE id = ?", args: [id] });
    fail("Another season was just created.");
  }
  await logEvent(id, "season_created", actor, clean);
  return (await getSeason(id))!;
}

export async function openSignups(seasonId: number, days: number, actor: Actor): Promise<void> {
  const season = await seasonOrFail(seasonId);
  const d = Math.max(1, Math.min(30, Math.round(Number(days) || 7)));
  if (!(await claim(season.id, ["draft", "signup"], "signup", { signup_close: Date.now() + d * DAY }))) {
    fail(`Sign-ups can't open: ${season.name} is already past sign-ups.`);
  }
  await logEvent(season.id, "signups_opened", actor, `${d} days`);
}

export async function cancelSeason(seasonId: number, confirmName: string, actor: Actor): Promise<void> {
  const season = await seasonOrFail(seasonId);
  if (confirmName.trim() !== season.name) fail(`Type the season name (${season.name}) to confirm.`);
  if (!(await claim(season.id, OPEN_STATUSES, "cancelled"))) fail(`${season.name} is already finished or cancelled.`);
  await logEvent(season.id, "season_cancelled", actor, season.name);
}

/** Staff remove a team from the season (a joke or duplicate sign-up) before the start. */
export async function removeEntry(seasonId: number, teamId: string, actor: Actor): Promise<void> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "signup" && season.status !== "drawn") {
    fail("Teams can only be removed before the season starts.");
  }
  const entry = (await seasonEntries(season.id)).find((e) => e.teamId === teamId);
  if (!entry) fail("That team isn't signed up.");
  await client.execute({ sql: "DELETE FROM league_entries WHERE id = ?", args: [entry!.id] });
  await logEvent(season.id, "team_removed", actor, entry!.teamName);
}

// --- the draw -------------------------------------------------------------------------------

interface DrawnEntry extends Entry {
  problems: string[];
}

export interface DrawPlan {
  divisions: {
    name: string;
    tier: number;
    code: string;
    format: DivisionFormat;
    teams: { teamId: string; name: string; tag: string; seedElo: number; access: string | null }[];
  }[];
  notPlaced: { teamId: string; name: string; note: string }[];
}

/** Re-read every roster from its team, apply the rules and seed — nothing is written. */
async function computeDraw(
  season: Season
): Promise<{ eligible: DrawnEntry[]; ineligible: DrawnEntry[]; access: Record<string, string> }> {
  const signed = await seasonEntries(season.id);
  const claimed = new Set<string>();
  const eligible: DrawnEntry[] = [];
  const ineligible: DrawnEntry[] = [];
  for (const e of signed) {
    const team = await getTeam(e.teamId);
    let roster: RosterPlayer[] = e.roster;
    const problems: string[] = [];
    if (!team) problems.push("the team was deleted");
    else {
      const check = rosterFromTeam(team);
      roster = check.roster;
      problems.push(...check.problems.map((p) => p.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())));
      const clashing = roster.filter((r) => claimed.has(r.discordId)).map((r) => r.playerName || r.username);
      if (clashing.length) problems.push(`already playing for another team: ${clashing.join(", ")}`);
    }
    const next: DrawnEntry = {
      ...e,
      roster,
      teamName: team?.name ?? e.teamName,
      teamTag: team?.tag ?? e.teamTag,
      seedElo: await seedElo(roster),
      problems,
      status: problems.length ? "ineligible" : "active",
      note: problems.length ? problems.join("; ") : null,
      divisionId: null,
    };
    if (problems.length) ineligible.push(next);
    else {
      eligible.push(next);
      for (const r of roster) claimed.add(r.discordId);
    }
  }
  const access = Object.fromEntries(await teamAccessMap(eligible.map((e) => e.teamId)));
  return { eligible, ineligible, access };
}

function planOf(eligible: DrawnEntry[], ineligible: DrawnEntry[], access: Record<string, string>): DrawPlan {
  return {
    divisions: planDivisions(eligible, access).map((d, i) => ({
      name: d.name,
      tier: i + 1,
      code: d.code,
      format: d.format,
      teams: d.teams.map((e) => ({
        teamId: e.teamId,
        name: e.teamName,
        tag: e.teamTag,
        seedElo: e.seedElo ?? 0,
        access: access[e.teamId] ?? null,
      })),
    })),
    notPlaced: ineligible.map((e) => ({ teamId: e.teamId, name: e.teamName, note: e.note ?? "" })),
  };
}

export async function previewDraw(seasonId: number): Promise<DrawPlan> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "signup") fail(`${season.name} isn't taking sign-ups.`);
  const live = (await listSeasons()).find((s) => LIVE_STATUSES.includes(s.status) && s.id !== season.id);
  if (live) fail(`Finish ${live.name} first: the next season's divisions are drawn after it ends.`);
  const { eligible, ineligible, access } = await computeDraw(season);
  return planOf(eligible, ineligible, access);
}

/** Close sign-ups: lock rosters, drop teams that break the rules, draw the divisions. */
export async function closeSignups(seasonId: number, actor: Actor): Promise<DrawPlan> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "signup") fail(`${season.name} isn't taking sign-ups.`);
  const live = (await listSeasons()).find((s) => LIVE_STATUSES.includes(s.status) && s.id !== season.id);
  if (live) fail(`Finish ${live.name} first: the next season's divisions are drawn after it ends.`);
  const { eligible, ineligible, access } = await computeDraw(season);
  const plan = planOf(eligible, ineligible, access); // throws before any write
  if (!(await claim(season.id, ["signup"], "drawn"))) fail("Sign-ups were already closed (from Discord or the website).");
  try {
    await client.execute({ sql: "DELETE FROM league_divisions WHERE season_id = ?", args: [season.id] });
    const divisionOf = new Map<string, number>();
    for (const d of plan.divisions) {
      const rs = await client.execute({
        sql: "INSERT INTO league_divisions (season_id, name, tier, code, format) VALUES (?, ?, ?, ?, ?)",
        args: [season.id, d.name, d.tier, d.code, d.format],
      });
      for (const t of d.teams) divisionOf.set(t.teamId, Number(rs.lastInsertRowid));
    }
    await client.batch(
      [...eligible, ...ineligible].map((e) => ({
        sql: `UPDATE league_entries SET team_name = ?, team_tag = ?, roster = ?, seed_elo = ?,
                division_id = ?, status = ?, note = ? WHERE id = ?`,
        args: [e.teamName, e.teamTag, JSON.stringify(e.roster), e.seedElo, divisionOf.get(e.teamId) ?? null,
          e.status, e.note, e.id],
      })),
      "write"
    );
  } catch (error) {
    await claim(season.id, ["drawn"], "signup");
    throw error;
  }
  await logEvent(season.id, "divisions_drawn", actor, `${plan.divisions.length} divisions`);
  return plan;
}

export async function moveTeam(seasonId: number, teamId: string, divisionId: number, actor: Actor): Promise<void> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "drawn") fail("Teams can only be moved after the draw and before the season starts.");
  const division = (await seasonDivisions(season.id)).find((d) => d.id === divisionId);
  if (!division) fail("That division isn't in this season.");
  const entry = (await seasonEntries(season.id)).find((e) => e.teamId === teamId && e.status === "active");
  if (!entry) fail("That team isn't placed in this season.");
  await client.execute({
    sql: "UPDATE league_entries SET division_id = ? WHERE id = ?",
    args: [division!.id, entry!.id],
  });
  await logEvent(season.id, "team_moved", actor, `${entry!.teamName} → ${division!.name}`);
}

// --- start -------------------------------------------------------------------------------------

export interface StartPlan {
  firstWeek: number;
  ok: boolean;
  divisions: { id: number; name: string; teams: number; matches: number; format: DivisionFormat; problem: string | null }[];
}

async function startPlan(season: Season, firstWeek: number) {
  const divisions = await seasonDivisions(season.id);
  const placed = (await seasonEntries(season.id)).filter((e) => e.status === "active");
  const rows = divisions.map((d) => {
    const teams = drawOrder(placed.filter((e) => e.divisionId === d.id));
    const problem =
      teams.length < DIVISION_MIN || teams.length > CONFERENCE_MAX
        ? `${d.name} has ${teams.length} teams; each division needs ${DIVISION_MIN}–${CONFERENCE_MAX}.`
        : null;
    // Staff moves after the draw can change the size, so the format follows the teams.
    const format = formatFor(teams.length);
    const ids = teams.map((e) => e.teamId);
    let games: [number, string, string][] = [];
    let bye: string | null = null;
    if (!problem && format === "swiss") {
      // Swiss: only week 1 now; the bot's league loop pairs every later week.
      const [pairs, sitsOut] = firstRound(ids);
      games = pairs.map(([a, b]) => [1, a, b] as [number, string, string]);
      bye = sitsOut;
    } else if (!problem) {
      games = seasonSchedule(ids, season.weeks);
    }
    return { division: d, teams, games, bye, format, problem };
  });
  const plan: StartPlan = {
    firstWeek,
    ok: rows.length > 0 && rows.every((r) => !r.problem),
    divisions: rows.map((r) => ({
      id: r.division.id,
      name: r.division.name,
      teams: r.teams.length,
      matches: r.games.length,
      format: r.format,
      problem: r.problem,
    })),
  };
  return { plan, rows };
}

export async function previewStart(seasonId: number, firstWeekText: string, now = Date.now()): Promise<StartPlan> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "drawn") fail("Close sign-ups first — that draws the divisions.");
  return (await startPlan(season, parseFirstWeek(firstWeekText, now))).plan;
}

/** Write the regular-season schedule and start the season. */
export async function startSeason(seasonId: number, firstWeekText: string, actor: Actor, now = Date.now()): Promise<StartPlan> {
  const season = await seasonOrFail(seasonId);
  if (season.status !== "drawn") fail("Close sign-ups first — that draws the divisions.");
  const firstWeek = parseFirstWeek(firstWeekText, now);
  const { plan, rows } = await startPlan(season, firstWeek);
  if (!rows.length) fail("No divisions were drawn.");
  const bad = rows.find((r) => r.problem);
  if (bad) fail(`${bad.problem} Move teams first.`);
  if (!(await claim(season.id, ["drawn"], "regular", { start_date: firstWeek }))) {
    fail("The season was already started (from Discord or the website).");
  }
  const stamp = Date.now();
  try {
    await client.batch(
      rows.flatMap((r) => [
        { sql: "UPDATE league_divisions SET format = ? WHERE id = ?", args: [r.format, r.division.id] },
        ...r.games.map(([week, a, b]) => ({
          sql: `INSERT INTO league_matches (season_id, division_id, week, stage, team_a, team_b, bo, status, updated_at)
                VALUES (?, ?, ?, 'regular', ?, ?, ?, 'unscheduled', ?)`,
          args: [season.id, r.division.id, week, a, b, BO_REGULAR, stamp],
        })),
        ...(r.bye
          ? [{
              sql: "INSERT OR IGNORE INTO league_byes (season_id, division_id, week, team_id) VALUES (?, ?, 1, ?)",
              args: [season.id, r.division.id, r.bye],
            }]
          : []),
      ]),
      "write"
    );
  } catch (error) {
    await claim(season.id, ["regular"], "drawn", { start_date: null });
    throw error;
  }
  await logEvent(season.id, "season_started", actor, `${plan.divisions.reduce((s, d) => s + d.matches, 0)} matches`);
  return plan;
}

// --- league channel ----------------------------------------------------------------------------

export async function getLeagueChannelId(): Promise<string | null> {
  try {
    const rs = await client.execute({ sql: "SELECT value FROM bot_state WHERE key = ?", args: [LEAGUE_CHANNEL_KEY] });
    return rs.rows[0]?.value ? String(rs.rows[0].value) : null;
  } catch {
    return null;
  }
}

export async function setLeagueChannel(channelId: string, channelName: string, actor: Actor): Promise<void> {
  if (!/^\d{5,25}$/.test(channelId)) fail("Pick a channel from the list.");
  await client.execute("CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT)");
  await client.execute({
    sql: "INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)",
    args: [LEAGUE_CHANNEL_KEY, channelId],
  });
  await logEvent(null, "channel_set", actor, `#${channelName}`);
}

// --- Manage tab ------------------------------------------------------------------------------

/** Matches Match Staff should look at: disputes, stale reports, rooms that never opened, long-running. */
export async function needsStaff(seasonId: number, now = Date.now()) {
  const matches = await seasonMatches(seasonId);
  const entries = await seasonEntries(seasonId);
  const nameOf = (id: string) => entries.find((e) => e.teamId === id)?.teamName ?? id;
  const rs = await client.execute({
    sql: "SELECT id, reported_at, channel_id, note FROM league_matches WHERE season_id = ?",
    args: [seasonId],
  });
  const extra = new Map(rs.rows.map((r) => [Number(r.id), r]));
  const out: { matchId: number; week: number; teams: string; reason: string }[] = [];
  for (const m of matches) {
    const x = extra.get(m.id);
    const reportedAt = x?.reported_at == null ? null : Number(x.reported_at);
    const hasRoom = x?.channel_id != null;
    let reason: string | null = null;
    if (m.status === "disputed") reason = `Disputed — ${x?.note ?? "needs a result"}`;
    else if (m.status === "reported" && reportedAt && now - reportedAt > 12 * HOUR) reason = "Result not confirmed for 12+ hours";
    else if (m.status === "scheduled" && m.scheduledAt && !hasRoom && now > m.scheduledAt + 20 * 60_000) {
      reason = "Match room didn't open (a team may have no players in the server)";
    } else if (m.status === "live" && m.scheduledAt && now > m.scheduledAt + 3 * HOUR) {
      reason = "Live for 3+ hours with no result";
    }
    if (reason) out.push({ matchId: m.id, week: m.week, teams: `${nameOf(m.teamA)} vs ${nameOf(m.teamB)}`, reason });
  }
  return out;
}

export async function adminView(seasonId: number | null, now = Date.now()) {
  const seasons = await listSeasons();
  const live = seasons.find((s) => LIVE_STATUSES.includes(s.status)) ?? null;
  const upcoming = seasons.find((s) => UPCOMING_STATUSES.includes(s.status)) ?? null;
  const season = (seasonId ? seasons.find((s) => s.id === seasonId) : null) ?? live ?? upcoming ?? null;
  const channelId = await getLeagueChannelId();
  const running = {
    live: live ? { id: live.id, name: live.name, status: live.status } : null,
    upcoming: upcoming ? { id: upcoming.id, name: upcoming.name, status: upcoming.status } : null,
  };
  const accessRows = await teamAccessMap();
  if (!season) {
    return {
      ...running,
      season: null,
      openRegular: 0,
      openPlayoffs: 0,
      playoffFinalsCreated: 0,
      canCreate: !upcoming,
      entries: [],
      divisions: [],
      needsStaff: [],
      events: await listEvents(null),
      channelId,
    };
  }
  const entries = await seasonEntries(season.id);
  const divisions = await seasonDivisions(season.id);
  const matches = await seasonMatches(season.id);
  const isDone = (m: { status: string }) => m.status === "final" || m.status === "forfeit";
  return {
    season,
    // Regular-season matches without a result (the playoffs can't start until 0).
    openRegular: matches.filter((m) => m.stage === "regular" && !isDone(m)).length,
    // Finals + third-place matches still to play (the season can't end until 0).
    openPlayoffs: matches.filter((m) => m.stage === "playoff" && !isDone(m)).length,
    playoffFinalsCreated: matches.filter((m) => m.playoffRound === "final").length,
    ...running,
    canCreate: !upcoming,
    entries: entries.map((e) => ({
      access: accessRows.get(e.teamId) ?? null,
      teamId: e.teamId,
      name: e.teamName,
      tag: e.teamTag,
      seedElo: e.seedElo,
      status: e.status,
      note: e.note,
      divisionId: e.divisionId,
      roster: e.roster.map((p) => p.playerName || p.username),
      signedUpAt: e.signedUpAt,
    })),
    divisions: divisions.map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      code: d.code,
      teams: entries.filter((e) => e.divisionId === d.id && e.status === "active").length,
    })),
    needsStaff: await needsStaff(season.id, now),
    events: await listEvents(season.id),
    channelId,
  };
}

export type LeagueAdminView = Awaited<ReturnType<typeof adminView>>;
