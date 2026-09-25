/**
 * Team League (phase 2): seasons, sign-ups, divisions, schedule and standings.
 *
 * Match Staff run a season from Discord (/league create → opensignups →
 * closesignups → start; see core/league.py in the bot). The website lets team
 * captains sign up while sign-ups are open and shows the divisions, standings
 * and schedule. Same tables as core/league.py — keep both DDLs in sync.
 * League games never touch ranked Elo; standings are computed here.
 */
import { client } from "@/lib/db";
import { getTeam, listTeams, type Team } from "@/lib/teams";
import { swissStandings } from "@/lib/league-swiss";

/** TESTING: 1 so small teams can try the league. The real rule is 5 — change it
 * back here and in core/league.py before a real season. */
export const ROSTER_MIN = Number(process.env.HL_LEAGUE_ROSTER_MIN) || 1;
export const ROSTER_MAX = 7;
export const SEED_TOP_PLAYERS = 5;
export const UNRANKED_ELO = 1200;
export const SEASON_WEEKS = 6;
export const PRIZES = [5000, 2500, 1000] as const;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** No agreed time → Sunday 20:00 UTC of the match week. */
const DEFAULT_SLOT_OFFSET_MS = 6 * DAY_MS + 20 * 3_600_000;

export type SeasonStatus = "draft" | "signup" | "drawn" | "regular" | "playoffs" | "finished" | "cancelled";
export type EntryStatus = "signed_up" | "active" | "ineligible";
export type MatchStatus =
  | "unscheduled"
  | "proposed"
  | "scheduled"
  | "live"
  | "reported"
  | "disputed"
  | "final"
  | "forfeit";

export interface Season {
  id: number;
  name: string;
  status: SeasonStatus;
  signupClose: number | null;
  startDate: number | null;
  weeks: number;
  /** Season page details Match Staff edit on the website. */
  bannerUrl?: string | null;
  description?: string | null;
  rules?: string | null;
  notice?: string | null;
  createdAt?: number | null;
}

/** A live season (being played) and an upcoming one (sign-ups) can run side by side. */
export const UPCOMING_STATUSES: SeasonStatus[] = ["draft", "signup"];
export const LIVE_STATUSES: SeasonStatus[] = ["drawn", "regular", "playoffs"];

// --- invite-only named divisions + Open skill bands (same as core/league.py) ---------------

export const ACCESS_TIERS = [
  ["pro", "Pro"],
  ["advanced", "Advanced"],
  ["main", "Main"],
  ["intermediate", "Intermediate"],
  ["entry", "Entry"],
] as const;
export type AccessCode = (typeof ACCESS_TIERS)[number][0];
/** [code, name, min Elo]: star / S2-S3 / A2-S1 / D-A1 */
export const OPEN_BANDS = [
  ["open10", "Open 10", 2500],
  ["open89", "Open 8-9", 1900],
  ["open57", "Open 5-7", 1250],
  ["open14", "Open 1-4", 0],
] as const;
export const DIVISION_ORDER: [string, string][] = [
  ...ACCESS_TIERS.map(([c, n]) => [c, n] as [string, string]),
  ...OPEN_BANDS.map(([c, n]) => [c, n] as [string, string]),
];
export const DIVISION_NAMES: Record<string, string> = Object.fromEntries(DIVISION_ORDER);
export const ACCESS_CODES: string[] = ACCESS_TIERS.map(([c]) => c);
/**
 * A team's stored status (league_team_access): a named tier, or Open10 once it
 * was promoted there from Open 8-9 (league v2). No status = its Open skill band.
 * Same as STATUS_CODES in core/league.py.
 */
export const STATUS_CODES: string[] = [...ACCESS_CODES, "open10"];

/** The Open division code for a team's seed Elo. */
export function openBand(elo: number | null | undefined): string {
  for (const [code, , floor] of OPEN_BANDS) if ((elo ?? 0) >= floor) return code;
  return OPEN_BANDS[OPEN_BANDS.length - 1][0];
}

/** "Main Access", or the team's Open band ("Open 5-7 Access") when it has none. */
export function accessLabel(access: string | null | undefined, seedElo?: number | null): string {
  const code = access && STATUS_CODES.includes(access) ? access : openBand(seedElo);
  return `${DIVISION_NAMES[code]} Access`;
}

/** team id → access code, for teams Match Staff gave a named division. */
export async function teamAccessMap(teamIds?: string[]): Promise<Map<string, string>> {
  await ensureLeagueSchema();
  if (teamIds && teamIds.length === 0) return new Map();
  const rs = await client.execute({
    sql:
      "SELECT team_id, access FROM league_team_access" +
      (teamIds ? ` WHERE team_id IN (${teamIds.map(() => "?").join(",")})` : ""),
    args: teamIds ?? [],
  });
  const out = new Map<string, string>();
  for (const r of rs.rows) {
    const access = String(r.access);
    if (STATUS_CODES.includes(access)) out.set(String(r.team_id), access);
  }
  return out;
}

/** A team's country: the most common country among its players (ties: first seen). */
export async function teamCountries(rosters: Map<string, string[]>): Promise<Map<string, string | null>> {
  const names = [...new Set([...rosters.values()].flat().filter(Boolean))];
  const byName = new Map<string, string>();
  if (names.length) {
    const rs = await client
      .execute({
        sql: `SELECT LOWER(name) AS n, country FROM players WHERE LOWER(name) IN (${names.map(() => "?").join(",")})`,
        args: names.map((n) => n.toLowerCase()),
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const r of rs.rows as Record<string, unknown>[]) {
      if (r.country) byName.set(String(r.n), String(r.country));
    }
  }
  const out = new Map<string, string | null>();
  for (const [teamId, players] of rosters) {
    const counts = new Map<string, number>();
    for (const p of players) {
      const c = byName.get(p.toLowerCase());
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: string | null = null;
    for (const [c, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = c;
    out.set(teamId, best);
  }
  return out;
}

export interface RosterPlayer {
  discordId: string;
  playerName: string | null;
  username: string;
  role: string;
}

export interface Entry {
  id: number;
  seasonId: number;
  teamId: string;
  teamName: string;
  teamTag: string;
  captainId: string | null;
  roster: RosterPlayer[];
  seedElo: number | null;
  divisionId: number | null;
  status: EntryStatus;
  note: string | null;
  signedUpAt: number;
  /** Set when the season ends: 1 = champion. */
  finalPlace?: number | null;
  /** Promotion/relegation at season end (league v2). */
  movement?: "up" | "down" | null;
  /** The status it moved to ("" = back to its Open skill band). */
  movedTo?: string | null;
  /** HL Coins paid to each rostered player. */
  prize?: number | null;
}

export type PlayoffRound = "semi1" | "semi2" | "final" | "third";

export interface Division {
  id: number;
  name: string;
  tier: number;
  /** "main", "open57", merged "pro+advanced" (null on seasons drawn before invite-only divisions). */
  code: string | null;
  /** "rr" round-robin (up to 7 teams) | "swiss" (league v2); null on older seasons = round-robin. */
  format: "rr" | "swiss" | null;
}

export interface LeagueMatch {
  id: number;
  divisionId: number | null;
  week: number;
  stage: string;
  teamA: string;
  teamB: string;
  bo: number;
  status: MatchStatus;
  scheduledAt: number | null;
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  playoffRound?: PlayoffRound | null;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  roundsFor: number;
  roundsAgainst: number;
  /** Round difference, including −1 per forfeit loss. */
  rd: number;
  points: number;
}

let schemaReady: Promise<void> | null = null;

/** Same tables as core/league.py, so a fresh DB works whichever side runs first. */
export function ensureLeagueSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(`CREATE TABLE IF NOT EXISTS league_seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        signup_close INTEGER,
        start_date INTEGER,
        weeks INTEGER NOT NULL DEFAULT 6,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      await client.execute(`CREATE TABLE IF NOT EXISTS league_divisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        tier INTEGER NOT NULL,
        code TEXT
      )`);
      // Invite-only named divisions: Match Staff give a team access (kept between seasons).
      await client.execute(`CREATE TABLE IF NOT EXISTS league_team_access (
        team_id TEXT PRIMARY KEY,
        access TEXT NOT NULL,
        set_by TEXT,
        set_by_id TEXT,
        set_at INTEGER NOT NULL
      )`);
      await client.execute(`CREATE TABLE IF NOT EXISTS league_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        team_id TEXT NOT NULL,
        team_name TEXT NOT NULL,
        team_tag TEXT,
        captain_id TEXT,
        roster TEXT NOT NULL DEFAULT '[]',
        seed_elo INTEGER,
        division_id INTEGER,
        status TEXT NOT NULL DEFAULT 'signed_up',
        note TEXT,
        signed_up_at INTEGER NOT NULL,
        UNIQUE (season_id, team_id)
      )`);
      await client.execute(`CREATE TABLE IF NOT EXISTS league_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        division_id INTEGER,
        week INTEGER NOT NULL,
        stage TEXT NOT NULL DEFAULT 'regular',
        team_a TEXT NOT NULL,
        team_b TEXT NOT NULL,
        bo INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unscheduled',
        proposed_time INTEGER,
        proposed_by TEXT,
        scheduled_at INTEGER,
        channel_id TEXT,
        score_a INTEGER,
        score_b INTEGER,
        maps TEXT,
        winner TEXT,
        reported_by TEXT,
        confirmed_by TEXT,
        updated_at INTEGER,
        reported_at INTEGER,
        result_kind TEXT,
        reminded INTEGER NOT NULL DEFAULT 0,
        note TEXT
      )`);
      // Staff audit log; season steps in ANNOUNCED kinds get posted by the bot.
      await client.execute(`CREATE TABLE IF NOT EXISTS league_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER,
        match_id INTEGER,
        kind TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        source TEXT,
        detail TEXT,
        announced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`);
      // Phase 3 columns on tables created before them (same list as core/league.py).
      const cols = await client.execute("PRAGMA table_info(league_matches)");
      const have = new Set(cols.rows.map((r) => String((r as Record<string, unknown>).name)));
      for (const [col, ddl] of [
        ["reported_at", "INTEGER"],
        ["result_kind", "TEXT"],
        ["reminded", "INTEGER NOT NULL DEFAULT 0"],
        ["note", "TEXT"],
        ["playoff_round", "TEXT"],
      ]) {
        if (!have.has(col)) await client.execute(`ALTER TABLE league_matches ADD COLUMN ${col} ${ddl}`);
      }
      // Phase 4 (season end) columns on entries — same list as core/league.py.
      const ecols = await client.execute("PRAGMA table_info(league_entries)");
      const ehave = new Set(ecols.rows.map((r) => String((r as Record<string, unknown>).name)));
      for (const [col, ddl] of [
        ["final_place", "INTEGER"],
        ["movement", "TEXT"],
        ["prize", "INTEGER"],
        ["moved_to", "TEXT"],
      ]) {
        if (!ehave.has(col)) await client.execute(`ALTER TABLE league_entries ADD COLUMN ${col} ${ddl}`);
      }
      // Invite-only divisions + season page details (same lists as core/league.py).
      // Same list as DIVISION_EXTRA_COLUMNS in core/league.py.
      const dcols = await client.execute("PRAGMA table_info(league_divisions)");
      const dhave = new Set(dcols.rows.map((r) => String((r as Record<string, unknown>).name)));
      for (const col of ["code", "format"]) {
        if (!dhave.has(col)) await client.execute(`ALTER TABLE league_divisions ADD COLUMN ${col} TEXT`);
      }
      const scols = await client.execute("PRAGMA table_info(league_seasons)");
      const shave = new Set(scols.rows.map((r) => String((r as Record<string, unknown>).name)));
      for (const col of ["banner_url", "description", "rules", "notice"]) {
        if (!shave.has(col)) await client.execute(`ALTER TABLE league_seasons ADD COLUMN ${col} TEXT`);
      }
      // One semi/final/third-place match per division, even if both sides create it at once.
      await client.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_league_playoff_round
         ON league_matches (season_id, division_id, playoff_round) WHERE playoff_round IS NOT NULL`
      );
      // Find Teammates board (lib/league-find.ts) — same DDL as core/league.py.
      // roles/days/times/divisions are JSON arrays of codes (lib/league-find-rules.ts).
      await client.execute(`CREATE TABLE IF NOT EXISTS league_team_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        team_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        roles TEXT NOT NULL DEFAULT '[]',
        days TEXT NOT NULL DEFAULT '[]',
        times TEXT NOT NULL DEFAULT '[]',
        language TEXT,
        min_elo INTEGER,
        max_elo INTEGER,
        open INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (season_id, team_id)
      )`);
      await client.execute(`CREATE TABLE IF NOT EXISTS league_player_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        discord_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        roles TEXT NOT NULL DEFAULT '[]',
        days TEXT NOT NULL DEFAULT '[]',
        times TEXT NOT NULL DEFAULT '[]',
        language TEXT,
        divisions TEXT NOT NULL DEFAULT '[]',
        open INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (season_id, discord_id)
      )`);
      await client.execute(`CREATE TABLE IF NOT EXISTS league_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        team_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        username TEXT,
        avatar TEXT,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        decided_at INTEGER,
        decided_by TEXT,
        UNIQUE (season_id, team_id, discord_id)
      )`);
      // League Stats (lib/league-stats.ts): one row per player per map, entered by
      // Match Staff — never mixed with ranked match_history. Same DDL as core/league.py.
      await client.execute(`CREATE TABLE IF NOT EXISTS league_match_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        match_id INTEGER NOT NULL,
        map_no INTEGER NOT NULL DEFAULT 1,
        map_name TEXT,
        team_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0,
        assists INTEGER NOT NULL DEFAULT 0,
        mvps INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0,
        hs REAL NOT NULL DEFAULT 0,
        rounds_won INTEGER NOT NULL DEFAULT 0,
        rounds_lost INTEGER NOT NULL DEFAULT 0,
        entered_by TEXT,
        entered_at INTEGER NOT NULL,
        UNIQUE (match_id, map_no, discord_id)
      )`);
      await client.execute("CREATE INDEX IF NOT EXISTS idx_league_match_stats_season ON league_match_stats (season_id)");
      // Swiss byes (lib/league-swiss.ts): the team that sits out a week, which counts as a win.
      await client.execute(`CREATE TABLE IF NOT EXISTS league_byes (
        season_id INTEGER NOT NULL,
        division_id INTEGER NOT NULL,
        week INTEGER NOT NULL,
        team_id TEXT NOT NULL,
        PRIMARY KEY (division_id, week)
      )`);
      // Pro ladder from league matches: each player's Pro Elo before/after every
      // counted match. Rebuilt by the bot (core/pro_league.py); read here. Same DDL.
      await client.execute(`CREATE TABLE IF NOT EXISTS league_pro_elo (
        match_id INTEGER NOT NULL,
        season_id INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        team_id TEXT NOT NULL,
        elo_before INTEGER NOT NULL,
        elo_after INTEGER NOT NULL,
        weight REAL NOT NULL,
        PRIMARY KEY (match_id, player_name)
      )`);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toSeason(r: Record<string, unknown>): Season {
  return {
    id: Number(r.id),
    name: String(r.name),
    status: String(r.status) as SeasonStatus,
    signupClose: num(r.signup_close),
    startDate: num(r.start_date),
    weeks: Number(r.weeks ?? SEASON_WEEKS),
    bannerUrl: r.banner_url == null ? null : String(r.banner_url),
    description: r.description == null ? null : String(r.description),
    rules: r.rules == null ? null : String(r.rules),
    notice: r.notice == null ? null : String(r.notice),
    createdAt: r.created_at == null ? null : Number(r.created_at),
  };
}

function toEntry(r: Record<string, unknown>): Entry {
  let roster: RosterPlayer[] = [];
  try {
    roster = JSON.parse(String(r.roster ?? "[]"));
  } catch {
    /* keep empty */
  }
  return {
    id: Number(r.id),
    seasonId: Number(r.season_id),
    teamId: String(r.team_id),
    teamName: String(r.team_name),
    teamTag: String(r.team_tag ?? ""),
    captainId: r.captain_id == null ? null : String(r.captain_id),
    roster,
    seedElo: num(r.seed_elo),
    divisionId: num(r.division_id),
    status: String(r.status) as EntryStatus,
    note: r.note == null ? null : String(r.note),
    signedUpAt: Number(r.signed_up_at),
    finalPlace: num(r.final_place),
    movement: r.movement == null ? null : (String(r.movement) as "up" | "down"),
    movedTo: r.moved_to == null ? null : String(r.moved_to),
    prize: num(r.prize),
  };
}

function toMatch(r: Record<string, unknown>): LeagueMatch {
  return {
    id: Number(r.id),
    divisionId: num(r.division_id),
    week: Number(r.week),
    stage: String(r.stage),
    teamA: String(r.team_a),
    teamB: String(r.team_b),
    bo: Number(r.bo ?? 1),
    status: String(r.status) as MatchStatus,
    scheduledAt: num(r.scheduled_at),
    scoreA: num(r.score_a),
    scoreB: num(r.score_b),
    winner: r.winner == null ? null : String(r.winner),
    playoffRound: r.playoff_round == null ? null : (String(r.playoff_round) as PlayoffRound),
  };
}

type Row = Record<string, unknown>;
const rows = (rs: { rows: unknown[] }) => rs.rows as Row[];

export async function listSeasons(): Promise<Season[]> {
  await ensureLeagueSchema();
  const rs = await client.execute(
    "SELECT * FROM league_seasons WHERE status != 'cancelled' ORDER BY id DESC"
  );
  return rows(rs).map(toSeason);
}

/** The running season, else the newest finished one (null when there are none). */
export async function currentSeason(): Promise<Season | null> {
  const seasons = await listSeasons();
  return (
    seasons.find((s) => LIVE_STATUSES.includes(s.status)) ??
    seasons.find((s) => UPCOMING_STATUSES.includes(s.status)) ??
    seasons[0] ??
    null
  );
}

/** The season being played (divisions drawn, regular season or playoffs). */
export async function liveSeason(): Promise<Season | null> {
  return (await listSeasons()).find((s) => LIVE_STATUSES.includes(s.status)) ?? null;
}

/** The next season (being set up or taking sign-ups). */
export async function upcomingSeason(): Promise<Season | null> {
  return (await listSeasons()).find((s) => UPCOMING_STATUSES.includes(s.status)) ?? null;
}

export async function getSeason(id: number): Promise<Season | null> {
  await ensureLeagueSchema();
  const rs = await client.execute({ sql: "SELECT * FROM league_seasons WHERE id = ?", args: [id] });
  const r = rows(rs)[0];
  return r ? toSeason(r) : null;
}

export async function seasonEntries(seasonId: number): Promise<Entry[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT * FROM league_entries WHERE season_id = ? ORDER BY signed_up_at, id",
    args: [seasonId],
  });
  return rows(rs).map(toEntry);
}

export async function seasonDivisions(seasonId: number): Promise<Division[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT id, name, tier, code, format FROM league_divisions WHERE season_id = ? ORDER BY tier",
    args: [seasonId],
  });
  return rows(rs).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    tier: Number(r.tier),
    code: r.code == null ? null : String(r.code),
    format: r.format === "swiss" ? "swiss" : r.format === "rr" ? "rr" : null,
  }));
}

export interface Bye {
  divisionId: number;
  week: number;
  teamId: string;
}

/** Swiss byes of a season (the team that sat out a week — counts as a win). */
export async function seasonByes(seasonId: number): Promise<Bye[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT division_id, week, team_id FROM league_byes WHERE season_id = ? ORDER BY week",
    args: [seasonId],
  });
  return rows(rs).map((r) => ({ divisionId: Number(r.division_id), week: Number(r.week), teamId: String(r.team_id) }));
}

/** A division's regular-season standings: head-to-head for round-robin, Buchholz (with byes) for Swiss. */
export function divisionStandingRows(
  format: Division["format"],
  teamIds: string[],
  matches: LeagueMatch[],
  byes: Bye[]
): (StandingRow & { buchholz?: number })[] {
  if (format === "swiss") return swissStandings(teamIds, matches, byes);
  return computeStandings(teamIds, matches);
}

export async function seasonMatches(seasonId: number): Promise<LeagueMatch[]> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT * FROM league_matches WHERE season_id = ? ORDER BY week, id",
    args: [seasonId],
  });
  return rows(rs).map(toMatch);
}

// --- rosters & sign-ups ------------------------------------------------------------------

/** A team's league roster (accepted members) and what stops it from signing up. */
export function rosterFromTeam(team: Team): { roster: RosterPlayer[]; problems: string[] } {
  const roster = team.members
    .filter((m) => m.status === "accepted")
    .map((m) => ({
      discordId: String(m.discordId),
      playerName: m.playerName || null,
      username: m.username || "",
      role: m.role || "starter",
    }));
  const problems: string[] = [];
  if (roster.length < ROSTER_MIN) {
    problems.push(`Needs at least ${ROSTER_MIN} accepted members (has ${roster.length}).`);
  }
  if (roster.length > ROSTER_MAX) {
    problems.push(`Can have at most ${ROSTER_MAX} members (has ${roster.length}).`);
  }
  const unlinked = roster.filter((r) => !r.playerName).map((r) => r.username || r.discordId);
  if (unlinked.length) problems.push(`Not linked to a player: ${unlinked.join(", ")}.`);
  return { roster, problems };
}

/** Average main Elo of the roster's best 5 (unranked players count as 1200). */
export async function seedElo(roster: RosterPlayer[]): Promise<number> {
  const names = roster.map((r) => r.playerName).filter((n): n is string => !!n);
  if (names.length === 0) return UNRANKED_ELO;
  const byName = new Map<string, number>();
  const rs = await client.execute({
    sql: `SELECT LOWER(name) AS n, elo, placement_done FROM players
          WHERE LOWER(name) IN (${names.map(() => "?").join(",")})`,
    args: names.map((n) => n.toLowerCase()),
  });
  for (const r of rows(rs)) {
    const elo = Number(r.elo ?? 0);
    byName.set(String(r.n), Number(r.placement_done) === 1 && elo > 0 ? elo : UNRANKED_ELO);
  }
  const top = names
    .map((n) => byName.get(n.toLowerCase()) ?? UNRANKED_ELO)
    .sort((a, b) => b - a)
    .slice(0, SEED_TOP_PLAYERS);
  return Math.round(top.reduce((s, e) => s + e, 0) / top.length);
}

/** Players of `roster` already on another team's entry this season. */
function clashes(roster: RosterPlayer[], others: Entry[]): string[] {
  const taken = new Map<string, string>();
  for (const e of others) {
    if (e.status === "ineligible") continue;
    for (const p of e.roster) taken.set(p.discordId, e.teamName);
  }
  return roster
    .filter((p) => taken.has(p.discordId))
    .map((p) => `${p.playerName || p.username} (${taken.get(p.discordId)})`);
}

export async function signUpTeam(teamId: string, captainId: string): Promise<Entry> {
  const season = await upcomingSeason();
  if (!season || season.status !== "signup") throw new Error("League sign-ups aren't open right now.");
  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found.");
  if (team.captainId !== captainId) throw new Error("Only the team captain can sign the team up.");
  const { roster, problems } = rosterFromTeam(team);
  if (problems.length) throw new Error(problems.join(" "));
  const existing = await seasonEntries(season.id);
  if (existing.some((e) => e.teamId === team.id)) throw new Error("This team is already signed up.");
  const taken = clashes(roster, existing);
  if (taken.length) {
    throw new Error(`Each player can play for one team per season. Already signed up: ${taken.join(", ")}.`);
  }
  await client.execute({
    sql: `INSERT INTO league_entries
            (season_id, team_id, team_name, team_tag, captain_id, roster, seed_elo, status, signed_up_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'signed_up', ?)`,
    args: [
      season.id,
      team.id,
      team.name,
      team.tag,
      team.captainId,
      JSON.stringify(roster),
      await seedElo(roster),
      Date.now(),
    ],
  });
  const entry = (await seasonEntries(season.id)).find((e) => e.teamId === team.id);
  if (!entry) throw new Error("Sign-up failed.");
  return entry;
}

export async function withdrawTeam(teamId: string, captainId: string): Promise<void> {
  const season = await upcomingSeason();
  if (!season || season.status !== "signup") {
    throw new Error("Teams can only withdraw while sign-ups are open. Ask Match Staff.");
  }
  const team = await getTeam(teamId);
  const entry = (await seasonEntries(season.id)).find((e) => e.teamId === teamId);
  if (!entry) throw new Error("This team isn't signed up.");
  const captain = team?.captainId ?? entry.captainId;
  if (captain !== captainId) throw new Error("Only the team captain can withdraw the team.");
  await client.execute({ sql: "DELETE FROM league_entries WHERE id = ?", args: [entry.id] });
}

// --- schedule & standings ------------------------------------------------------------------

/** Monday 00:00 UTC → Sunday 23:59:59.999 UTC of a match week. */
export function weekWindow(startDate: number, week: number): { start: number; end: number } {
  const start = startDate + (week - 1) * WEEK_MS;
  return { start, end: start + WEEK_MS - 1 };
}

export function defaultSlot(startDate: number, week: number): number {
  return weekWindow(startDate, week).start + DEFAULT_SLOT_OFFSET_MS;
}

/** Only confirmed results count: `final` (scores) and `forfeit`. */
function counted(m: LeagueMatch): boolean {
  return (m.status === "final" || m.status === "forfeit") && !!m.winner;
}

function tally(teamIds: string[], matches: LeagueMatch[]): Map<string, StandingRow> {
  const table = new Map<string, StandingRow>(
    teamIds.map((id) => [
      id,
      { teamId: id, played: 0, won: 0, lost: 0, roundsFor: 0, roundsAgainst: 0, rd: 0, points: 0 },
    ])
  );
  for (const m of matches) {
    if (!counted(m)) continue;
    const a = table.get(m.teamA);
    const b = table.get(m.teamB);
    if (!a || !b) continue;
    const winner = m.winner === m.teamA ? a : m.winner === m.teamB ? b : null;
    if (!winner) continue;
    const loser = winner === a ? b : a;
    for (const row of [a, b]) row.played += 1;
    winner.won += 1;
    winner.points += 3;
    loser.lost += 1;
    if (m.status === "forfeit") {
      loser.rd -= 1;
      continue;
    }
    const sa = m.scoreA ?? 0;
    const sb = m.scoreB ?? 0;
    a.roundsFor += sa;
    a.roundsAgainst += sb;
    b.roundsFor += sb;
    b.roundsAgainst += sa;
    a.rd += sa - sb;
    b.rd += sb - sa;
  }
  return table;
}

/**
 * Division standings. Win 3 pts, loss 0; a forfeit loss also costs 1 round
 * of difference. Ties: points → head-to-head points between the tied teams
 * → round difference → rounds won → team id (stable).
 */
export function computeStandings(teamIds: string[], matches: LeagueMatch[]): StandingRow[] {
  const table = tally(teamIds, matches);
  const all = [...table.values()];
  const byPoints = new Map<number, StandingRow[]>();
  for (const row of all) byPoints.set(row.points, [...(byPoints.get(row.points) ?? []), row]);
  const out: StandingRow[] = [];
  for (const pts of [...byPoints.keys()].sort((x, y) => y - x)) {
    const group = byPoints.get(pts)!;
    let h2h = new Map<string, number>();
    if (group.length > 1) {
      const ids = new Set(group.map((r) => r.teamId));
      const mini = tally(
        [...ids],
        matches.filter((m) => ids.has(m.teamA) && ids.has(m.teamB))
      );
      h2h = new Map([...mini.values()].map((r) => [r.teamId, r.points]));
    }
    group.sort(
      (x, y) =>
        (h2h.get(y.teamId) ?? 0) - (h2h.get(x.teamId) ?? 0) ||
        y.rd - x.rd ||
        y.roundsFor - x.roundsFor ||
        (x.teamId < y.teamId ? -1 : x.teamId > y.teamId ? 1 : 0)
    );
    out.push(...group);
  }
  return out;
}

// --- page payload ------------------------------------------------------------------------

export interface TeamBadge {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
}

export interface CaptainTeamOption extends TeamBadge {
  memberCount: number;
  problems: string[];
  seedElo: number | null;
  signedUp: boolean;
  /** "Main Access" or the team's Open band ("Open 5-7 Access"). */
  access: string;
  /** Match Staff gave it an invite-only division. */
  inviteOnly: boolean;
}

/** Everything the /league page shows for a season (read-only apart from sign-ups). */
export async function leagueView(seasonId: number | null, viewerId: string | null) {
  const seasons = await listSeasons();
  const season =
    (seasonId ? seasons.find((s) => s.id === seasonId) : null) ??
    seasons.find((s) => LIVE_STATUSES.includes(s.status)) ??
    seasons.find((s) => UPCOMING_STATUSES.includes(s.status)) ??
    seasons[0] ??
    null;
  const teams = await listTeams();
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const badge = (id: string, fallback?: Entry): TeamBadge => {
    const t = teamById.get(id);
    return {
      id,
      name: t?.name ?? fallback?.teamName ?? "Unknown team",
      tag: t?.tag ?? fallback?.teamTag ?? "",
      logoUrl: t?.logoUrl ?? null,
      accentColor: t?.accentColor ?? "#ff5500",
    };
  };

  if (!season) {
    return {
      seasons: [],
      season: null,
      prizes: PRIZES,
      roster: { min: ROSTER_MIN, max: ROSTER_MAX },
      entries: [],
      divisions: [],
      viewer: null,
    };
  }

  const entries = await seasonEntries(season.id);
  const entryByTeam = new Map(entries.map((e) => [e.teamId, e]));
  const divisions = await seasonDivisions(season.id);
  const matches = await seasonMatches(season.id);
  const byes = await seasonByes(season.id);
  const myTeamIds = viewerId
    ? entries
        .filter((e) => e.status !== "ineligible" && e.roster.some((p) => p.discordId === viewerId))
        .map((e) => e.teamId)
    : [];

  const divisionViews = divisions.map((d) => {
    const teamIds = entries
      .filter((e) => e.divisionId === d.id && e.status === "active")
      .map((e) => e.teamId);
    const divMatches = matches.filter((m) => m.divisionId === d.id);
    const weeks = [...new Set(divMatches.map((m) => m.week))].sort((a, b) => a - b);
    const summary = (m: LeagueMatch) => ({
      id: m.id,
      bo: m.bo,
      status: m.status,
      scheduledAt: m.scheduledAt,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      winner: m.winner,
      round: m.playoffRound ?? null,
      teamA: badge(m.teamA, entryByTeam.get(m.teamA)),
      teamB: badge(m.teamB, entryByTeam.get(m.teamB)),
      mine: myTeamIds.includes(m.teamA) || myTeamIds.includes(m.teamB),
    });
    const round = (r: PlayoffRound) => {
      const m = divMatches.find((x) => x.playoffRound === r);
      return m ? summary(m) : null;
    };
    const placed = entries
      .filter((e) => e.divisionId === d.id && e.finalPlace)
      .sort((x, y) => (x.finalPlace ?? 0) - (y.finalPlace ?? 0));
    const divByes = byes.filter((b) => b.divisionId === d.id);
    return {
      id: d.id,
      name: d.name,
      tier: d.tier,
      code: d.code,
      format: d.format ?? "rr",
      byes: divByes.map((b) => ({ week: b.week, team: badge(b.teamId, entryByTeam.get(b.teamId)) })),
      playoffs: divMatches.some((m) => m.playoffRound)
        ? { semi1: round("semi1"), semi2: round("semi2"), final: round("final"), third: round("third") }
        : null,
      places: placed.map((e) => ({
        place: e.finalPlace!,
        team: badge(e.teamId, e),
        movement: e.movement ?? null,
        movedTo: e.movedTo ?? null,
        prize: e.prize ?? 0,
      })),
      // Standings are the regular season only; the playoffs decide the final places.
      standings: divisionStandingRows(
        d.format,
        teamIds,
        divMatches.filter((m) => m.stage === "regular"),
        divByes
      ).map((row) => ({
        ...row,
        team: badge(row.teamId, entryByTeam.get(row.teamId)),
        seedElo: entryByTeam.get(row.teamId)?.seedElo ?? null,
      })),
      weeks: weeks.map((week) => ({
        week,
        ...(season.startDate
          ? {
              ...weekWindow(season.startDate, week),
              defaultSlot: defaultSlot(season.startDate, week),
            }
          : { start: null, end: null, defaultSlot: null }),
        matches: divMatches.filter((m) => m.week === week).map(summary),
      })),
    };
  });

  let captainTeams: CaptainTeamOption[] = [];
  if (viewerId) {
    const others = entries;
    const mine = teams.filter((t) => t.captainId === viewerId);
    const access = await teamAccessMap(mine.map((t) => t.id));
    captainTeams = await Promise.all(
      mine.map(async (t) => {
        const { roster, problems } = rosterFromTeam(t);
        const signedUp = entryByTeam.has(t.id);
        const taken = signedUp ? [] : clashes(roster, others);
        if (taken.length) problems.push(`Already on another team this season: ${taken.join(", ")}.`);
        const elo = problems.length ? null : await seedElo(roster);
        const code = access.get(t.id) ?? null;
        return {
          ...badge(t.id),
          memberCount: roster.length,
          problems,
          seedElo: elo,
          signedUp,
          access: accessLabel(code, elo),
          inviteOnly: code !== null,
        };
      })
    );
  }

  return {
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    season,
    prizes: PRIZES,
    roster: { min: ROSTER_MIN, max: ROSTER_MAX },
    entries: entries.map((e) => ({
      teamId: e.teamId,
      team: badge(e.teamId, e),
      seedElo: e.seedElo,
      status: e.status,
      note: e.note,
      divisionId: e.divisionId,
      rosterSize: e.roster.length,
      roster: e.roster.map((p) => p.playerName || p.username),
      signedUpAt: e.signedUpAt,
    })),
    divisions: divisionViews,
    viewer: viewerId ? { captainTeams, myTeamIds } : null,
  };
}

export type LeagueView = Awaited<ReturnType<typeof leagueView>>;

/** A team's league seasons for its team page: division, record, final place, move, prize. */
export async function teamLeagueHistory(teamId: string) {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: `SELECT e.season_id, s.name AS season_name, s.status AS season_status, d.name AS division, d.tier,
                 d.id AS division_id, d.code AS division_code,
                 (SELECT COUNT(*) FROM league_entries x WHERE x.division_id = e.division_id AND x.status = 'active') AS teams,
                 e.final_place, e.movement, e.moved_to, e.prize, e.status
          FROM league_entries e
          JOIN league_seasons s ON s.id = e.season_id
          LEFT JOIN league_divisions d ON d.id = e.division_id
          WHERE e.team_id = ? AND s.status != 'cancelled'
          ORDER BY e.season_id DESC`,
    args: [teamId],
  });
  const out = [];
  for (const r of rows(rs)) {
    const seasonId = Number(r.season_id);
    const matches = (await seasonMatches(seasonId)).filter(
      (m) => (m.teamA === teamId || m.teamB === teamId) && (m.status === "final" || m.status === "forfeit") && m.winner
    );
    const won = matches.filter((m) => m.winner === teamId).length;
    out.push({
      seasonId,
      season: String(r.season_name),
      seasonStatus: String(r.season_status) as SeasonStatus,
      division: r.division == null ? null : String(r.division),
      divisionId: num(r.division_id),
      divisionCode: r.division_code == null ? null : String(r.division_code),
      tier: r.tier == null ? null : Number(r.tier),
      /** Teams placed in that division (conference). */
      teams: Number(r.teams ?? 0),
      played: matches.length,
      won,
      lost: matches.length - won,
      finalPlace: num(r.final_place),
      movement: r.movement === "up" || r.movement === "down" ? (r.movement as "up" | "down") : null,
      /** Where it moved ("" = back to its Open skill band). */
      movedTo: r.moved_to == null ? null : String(r.moved_to),
      prize: num(r.prize),
      placed: String(r.status) === "active",
    });
  }
  return out;
}

export type TeamLeagueSeason = Awaited<ReturnType<typeof teamLeagueHistory>>[number];

export interface TeamLeagueStatus {
  /** "intermediate", or the Open band ("open57") when it has no status. */
  code: string;
  name: string;
  /** No stored status: it plays in the Open band of its roster's Elo. */
  bySkill: boolean;
  /** The status came from a promotion/relegation (not Match Staff). */
  earned: boolean;
  /** The roster's seed Elo (only worked out when `bySkill`). */
  seedElo: number | null;
}

/** Where a team plays next season: its stored status, else its Open band by skill. */
export async function teamLeagueStatus(team: Team): Promise<TeamLeagueStatus> {
  await ensureLeagueSchema();
  const rs = await client.execute({ sql: "SELECT access, set_by FROM league_team_access WHERE team_id = ?", args: [team.id] });
  const r = rows(rs)[0];
  const code = r ? String(r.access) : null;
  if (code && STATUS_CODES.includes(code)) {
    return { code, name: DIVISION_NAMES[code], bySkill: false, earned: String(r.set_by ?? "") === "League", seedElo: null };
  }
  const { roster } = rosterFromTeam(team);
  const elo = await seedElo(roster).catch(() => null);
  const band = openBand(elo);
  return { code: band, name: DIVISION_NAMES[band], bySkill: true, earned: false, seedElo: elo };
}

/** When each staff step first happened in a season (for the timeline): kind → ms. */
export async function seasonEventTimes(seasonId: number): Promise<Record<string, number>> {
  await ensureLeagueSchema();
  const rs = await client.execute({
    sql: "SELECT kind, MIN(created_at) AS at FROM league_events WHERE season_id = ? GROUP BY kind",
    args: [seasonId],
  });
  return Object.fromEntries(rows(rs).map((r) => [String(r.kind), Number(r.at)]));
}

export interface NextMatch {
  id: number;
  week: number;
  round: PlayoffRound | null;
  status: MatchStatus;
  scheduledAt: number | null;
  proposedTime: number | null;
  mine: string;
  opponent: string;
  division: string | null;
}

/** The viewer's next unplayed match this season (their team's), or null. */
export async function viewerNextMatch(seasonId: number, discordId: string): Promise<NextMatch | null> {
  const entries = await seasonEntries(seasonId);
  const mine = entries.find((e) => e.status === "active" && e.roster.some((p) => p.discordId === discordId));
  if (!mine) return null;
  const matches = (await seasonMatches(seasonId)).filter(
    (m) => (m.teamA === mine.teamId || m.teamB === mine.teamId) && m.status !== "final" && m.status !== "forfeit"
  );
  if (!matches.length) return null;
  matches.sort((a, b) => a.week - b.week || (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity) || a.id - b.id);
  const m = matches[0];
  const other = m.teamA === mine.teamId ? m.teamB : m.teamA;
  const proposed = await client.execute({ sql: "SELECT proposed_time FROM league_matches WHERE id = ?", args: [m.id] });
  const division = m.divisionId ? (await seasonDivisions(seasonId)).find((d) => d.id === m.divisionId)?.name ?? null : null;
  return {
    id: m.id,
    week: m.week,
    round: m.playoffRound ?? null,
    status: m.status,
    scheduledAt: m.scheduledAt,
    proposedTime: num(rows(proposed)[0]?.proposed_time),
    mine: mine.teamName,
    opponent: entries.find((e) => e.teamId === other)?.teamName ?? "TBD",
    division,
  };
}
