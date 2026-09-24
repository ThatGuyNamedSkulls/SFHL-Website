/**
 * League Stats (docs/LEAGUE_UI_PLAN.md step 9): one scoreboard per map of a
 * league match (BO3 playoffs have up to 3), entered by Match Staff with the
 * same fields as /rank. Pure: validation, reading pasted /ocr2rank output,
 * and the per-player totals the Stats tab shows. League stats never touch
 * ranked stats.
 */

export class StatsInputError extends Error {}

function fail(msg: string): never {
  throw new StatsInputError(msg);
}

export interface StatLine {
  teamId: string;
  discordId: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  mvps: number;
  score: number;
  /** Headshot % (0–100), as on the scoreboard. */
  hs: number;
}

export interface MapScoreboard {
  mapNo: number;
  mapName: string | null;
  /** Rounds won by team A / team B on this map. */
  roundsA: number;
  roundsB: number;
  players: StatLine[];
}

export interface MatchForStats {
  bo: number;
  teamA: string;
  teamB: string;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  /** discord id → name, per team. */
  rosterA: { discordId: string; name: string }[];
  rosterB: { discordId: string; name: string }[];
}

const MAX_ROUNDS = 99;
const MAX_STAT = 999;
const PER_TEAM_MAX = 7;

function int(v: unknown, what: string, max = MAX_STAT): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) fail(`${what} must be a whole number from 0 to ${max}.`);
  return n;
}

/** Check a staff-entered map scoreboard against the match; returns the cleaned version. */
export function validateScoreboard(raw: Record<string, unknown>, m: MatchForStats): MapScoreboard {
  if (m.status !== "final") fail("Stats can be entered once the match has a confirmed (non-forfeit) result.");
  const mapNo = int(raw.mapNo, "The map number", m.bo);
  if (mapNo < 1) fail(`The map number must be 1–${m.bo}.`);
  const roundsA = int(raw.roundsA, "Rounds", MAX_ROUNDS);
  const roundsB = int(raw.roundsB, "Rounds", MAX_ROUNDS);
  if (roundsA === roundsB) fail("A map can't end in a draw — check the round score.");
  if (m.bo === 1 && m.scoreA !== null && m.scoreB !== null && (roundsA !== m.scoreA || roundsB !== m.scoreB)) {
    fail(`The round score must match the result (${m.scoreA}–${m.scoreB}).`);
  }
  const mapName = String(raw.mapName ?? "").trim().slice(0, 40) || null;

  const rosters: Record<string, Map<string, string>> = {
    [m.teamA]: new Map(m.rosterA.map((p) => [p.discordId, p.name])),
    [m.teamB]: new Map(m.rosterB.map((p) => [p.discordId, p.name])),
  };
  const list = Array.isArray(raw.players) ? (raw.players as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const players: StatLine[] = list.map((p) => {
    const teamId = String(p.teamId ?? "");
    const roster = rosters[teamId];
    if (!roster) fail("Every player must be on one of the two teams.");
    const discordId = String(p.discordId ?? "");
    const name = roster.get(discordId);
    if (!name) fail("Every player must be on their team's league roster.");
    if (seen.has(discordId)) fail(`${name} is listed twice.`);
    seen.add(discordId);
    const hs = Number(p.hs ?? 0);
    if (!Number.isFinite(hs) || hs < 0 || hs > 100) fail(`${name}: HS% must be 0–100.`);
    return {
      teamId,
      discordId,
      name,
      kills: int(p.kills ?? 0, `${name}: kills`),
      deaths: int(p.deaths ?? 0, `${name}: deaths`),
      assists: int(p.assists ?? 0, `${name}: assists`),
      mvps: int(p.mvps ?? 0, `${name}: MVPs`),
      score: int(p.score ?? 0, `${name}: score`, 9999),
      hs: Math.round(hs * 10) / 10,
    };
  });
  for (const team of [m.teamA, m.teamB]) {
    const n = players.filter((p) => p.teamId === team).length;
    if (n === 0) fail("Add at least one player for each team.");
    if (n > PER_TEAM_MAX) fail(`At most ${PER_TEAM_MAX} players per team.`);
  }
  return { mapNo, mapName, roundsA, roundsB, players };
}

// --- /ocr2rank paste ---------------------------------------------------------------------

export interface PastedLine {
  name: string;
  result: "W" | "L" | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  mvps: number | null;
  score: number | null;
  hs: number | null;
}

export interface PastedScoreboard {
  mapName: string | null;
  /** From "points: winners,losers" when staff filled it in. */
  winnerRounds: number | null;
  loserRounds: number | null;
  players: PastedLine[];
}

const KEYS = ["player_names", "match_results", "scores", "kills", "deaths", "assists", "mvps", "hs", "points", "map_name", "region", "play_time"];

/**
 * Read what /ocr2rank prints ("/rank player_names: a,b kills: 3,4 …") or the
 * raw OCR JSON, so staff don't retype the scoreboard. Returns null if it
 * doesn't look like either.
 */
export function parseOcrPaste(text: string): PastedScoreboard | null {
  const src = text.trim().replace(/^```\w*|```$/g, "").trim();
  let fields: Record<string, string[]> = {};
  if (src.startsWith("{")) {
    try {
      const json = JSON.parse(src) as Record<string, unknown>;
      for (const [k, v] of Object.entries(json)) fields[k] = Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
    } catch {
      return null;
    }
  } else {
    const re = new RegExp(`\\b(${KEYS.join("|")})\\s*:\\s*`, "g");
    const hits = [...src.matchAll(re)];
    fields = {};
    hits.forEach((h, i) => {
      const end = i + 1 < hits.length ? hits[i + 1].index : src.length;
      fields[h[1]] = src
        .slice(h.index + h[0].length, end)
        .trim()
        .split(",")
        .map((s) => s.trim());
    });
  }
  const names = (fields.player_names ?? []).filter(Boolean);
  if (!names.length) return null;
  const num = (key: string, i: number) => {
    const v = fields[key]?.[i];
    const n = v === undefined || v === "" || /none/i.test(v) ? NaN : Number(v.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  };
  const points = (fields.points ?? []).map(Number);
  const mapName = fields.map_name?.[0]?.trim();
  return {
    mapName: mapName && !mapName.startsWith("<") ? mapName : null,
    winnerRounds: Number.isInteger(points[0]) ? points[0] : null,
    loserRounds: Number.isInteger(points[1]) ? points[1] : null,
    players: names.map((name, i) => {
      const r = fields.match_results?.[i]?.toUpperCase();
      return {
        name: name.replace(/^@/, ""),
        result: r === "W" || r === "L" ? r : null,
        kills: num("kills", i),
        deaths: num("deaths", i),
        assists: num("assists", i),
        mvps: num("mvps", i),
        score: num("scores", i),
        hs: num("hs", i),
      };
    }),
  };
}

/** Roster player whose name matches a scoreboard name (case/space-insensitive), if any. */
export function matchRosterName<T extends { name: string }>(name: string, roster: T[]): T | null {
  const key = (s: string) => s.toLowerCase().replace(/[\s_.-]+/g, "");
  const k = key(name);
  return roster.find((p) => key(p.name) === k) ?? null;
}

// --- Stats tab totals ----------------------------------------------------------------------

export interface StatRow {
  matchId: number;
  mapNo: number;
  teamId: string;
  discordId: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  mvps: number;
  score: number;
  hs: number;
  roundsWon: number;
  roundsLost: number;
}

export interface PlayerTotals {
  discordId: string;
  name: string;
  teamId: string;
  matches: number;
  maps: number;
  /** Matches their team won. */
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  mvps: number;
  rounds: number;
  /** Kill-weighted headshot %. */
  hs: number;
  kd: number;
  kr: number;
  /** Average score per map. */
  avgScore: number;
}

export const SORT_KEYS = ["kills", "deaths", "assists", "kd", "kr", "hs", "mvps", "wins", "matches", "maps", "rounds", "avgScore"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function parseSort(raw: unknown): SortKey {
  return typeof raw === "string" && (SORT_KEYS as readonly string[]).includes(raw) ? (raw as SortKey) : "kills";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Add each player's map lines up; `winners` maps match id → winning team id. */
export function playerTotals(rows: StatRow[], winners: Map<number, string | null>): PlayerTotals[] {
  const by = new Map<string, { rows: StatRow[] }>();
  for (const r of rows) {
    const g = by.get(r.discordId) ?? { rows: [] };
    g.rows.push(r);
    by.set(r.discordId, g);
  }
  return [...by.values()].map(({ rows: rs }) => {
    const sum = (f: (r: StatRow) => number) => rs.reduce((s, r) => s + f(r), 0);
    const matches = new Map<number, string>();
    for (const r of rs) matches.set(r.matchId, r.teamId);
    const kills = sum((r) => r.kills);
    const deaths = sum((r) => r.deaths);
    const rounds = sum((r) => r.roundsWon + r.roundsLost);
    const last = rs[rs.length - 1];
    return {
      discordId: last.discordId,
      name: last.name,
      teamId: last.teamId,
      matches: matches.size,
      maps: rs.length,
      wins: [...matches].filter(([id, team]) => winners.get(id) === team).length,
      kills,
      deaths,
      assists: sum((r) => r.assists),
      mvps: sum((r) => r.mvps),
      rounds,
      hs: kills ? Math.round((sum((r) => r.hs * r.kills) / kills) * 10) / 10 : 0,
      kd: round2(deaths ? kills / deaths : kills),
      kr: round2(rounds ? kills / rounds : 0),
      avgScore: Math.round(sum((r) => r.score) / rs.length),
    };
  });
}

/** Highest first ("deaths" too — the table's arrow flips it); ties by kills, then name. */
export function sortTotals<T extends PlayerTotals>(list: T[], key: SortKey, asc = false): T[] {
  const dir = asc ? 1 : -1;
  return [...list].sort(
    (a, b) => dir * (a[key] - b[key]) || b.kills - a.kills || a.name.localeCompare(b.name)
  );
}
