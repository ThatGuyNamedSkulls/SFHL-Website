/**
 * Find Teammates (docs/LEAGUE_UI_PLAN.md step 7): the option lists, post
 * validation and board filters. Pure — no DB — so client forms use it too.
 */

export const ROLES = [
  ["igl", "IGL"],
  ["awp", "AWP"],
  ["entry", "Entry"],
  ["lurk", "Lurk"],
  ["support", "Support"],
  ["rifler", "Rifler"],
  ["anchor", "Anchor"],
  ["sub", "Sub"],
  ["coach", "Coach"],
] as const;

export const DAYS = [
  ["mon", "M"],
  ["tue", "T"],
  ["wed", "W"],
  ["thu", "T"],
  ["fri", "F"],
  ["sat", "S"],
  ["sun", "S"],
] as const;

export const TIMES = [
  ["morning", "Morning"],
  ["afternoon", "Afternoon"],
  ["evening", "Evening"],
  ["night", "Night"],
] as const;

export const LANGUAGES = [
  ["en", "English"],
  ["pt", "Portuguese"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["pl", "Polish"],
  ["tr", "Turkish"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["other", "Other"],
] as const;

/** Division codes a player can aim for (same codes as lib/league.ts DIVISION_ORDER). */
export const TARGET_DIVISIONS = [
  ["pro", "Pro"],
  ["advanced", "Advanced"],
  ["main", "Main"],
  ["intermediate", "Intermediate"],
  ["entry", "Entry"],
  ["open10", "Open 10"],
  ["open89", "Open 8-9"],
  ["open57", "Open 5-7"],
  ["open14", "Open 1-4"],
] as const;

export const TITLE_MAX = 80;
export const BODY_MAX = 600;
export const MESSAGE_MAX = 400;
export const ELO_MAX = 5000;
/** Messages one player can send from the board per hour. */
export const MESSAGES_PER_HOUR = 5;

const codes = (list: readonly (readonly [string, string])[]) => list.map(([c]) => c as string);
export const labelOf = (list: readonly (readonly [string, string])[], code: string) =>
  list.find(([c]) => c === code)?.[1] ?? code;

export class FindInputError extends Error {}

export interface PostInput {
  title: string;
  body: string | null;
  roles: string[];
  days: string[];
  times: string[];
  language: string | null;
}

export interface TeamPostInput extends PostInput {
  minElo: number | null;
  maxElo: number | null;
}

export interface PlayerPostInput extends PostInput {
  divisions: string[];
}

function pick(raw: unknown, allowed: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.map(String));
  return allowed.filter((c) => set.has(c)); // keeps the canonical order, drops unknowns
}

function text(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function elo(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) throw new FindInputError("Elo must be a positive number.");
  return Math.min(n, ELO_MAX);
}

function common(raw: Record<string, unknown>): PostInput {
  const title = text(raw.title, TITLE_MAX);
  if (title.length < 3) throw new FindInputError("Give your post a title (at least 3 characters).");
  const body = String(raw.body ?? "").trim().slice(0, BODY_MAX) || null;
  const language = codes(LANGUAGES).includes(String(raw.language)) ? String(raw.language) : null;
  return {
    title,
    body,
    roles: pick(raw.roles, codes(ROLES)),
    days: pick(raw.days, codes(DAYS)),
    times: pick(raw.times, codes(TIMES)),
    language,
  };
}

export function normalizeTeamPost(raw: Record<string, unknown>): TeamPostInput {
  const base = common(raw);
  if (!base.roles.length) throw new FindInputError("Pick at least one role you're looking for.");
  const minElo = elo(raw.minElo);
  const maxElo = elo(raw.maxElo);
  if (minElo !== null && maxElo !== null && minElo > maxElo) {
    throw new FindInputError("The lowest Elo can't be above the highest.");
  }
  return { ...base, minElo, maxElo };
}

export function normalizePlayerPost(raw: Record<string, unknown>): PlayerPostInput {
  const base = common(raw);
  if (!base.roles.length) throw new FindInputError("Pick at least one role you play.");
  return { ...base, divisions: pick(raw.divisions, codes(TARGET_DIVISIONS)) };
}

export function normalizeMessage(raw: unknown): string {
  const msg = String(raw ?? "").trim().slice(0, MESSAGE_MAX);
  if (msg.length < 2) throw new FindInputError("Write a message first.");
  return msg;
}

// --- board filters ---------------------------------------------------------------------

export type FindTab = "teams" | "players" | "registered";

export interface FindFilters {
  tab: FindTab;
  division: string | null;
  language: string | null;
  role: string | null;
  minElo: number | null;
  maxElo: number | null;
}

const one = (raw: unknown, allowed: string[]) =>
  typeof raw === "string" && allowed.includes(raw) ? raw : null;

function eloParam(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,5}$/.test(raw)) return null;
  return Math.min(Number(raw), ELO_MAX);
}

export function parseFindFilters(q: Record<string, string | string[] | undefined>): FindFilters {
  return {
    tab: (one(q.tab, ["teams", "players", "registered"]) as FindTab | null) ?? "teams",
    division: one(q.division, codes(TARGET_DIVISIONS)),
    language: one(q.language, codes(LANGUAGES)),
    role: one(q.role, codes(ROLES)),
    minElo: eloParam(q.minElo),
    maxElo: eloParam(q.maxElo),
  };
}

/** A recruiting team: `division` is its access / Open band code, `elo` its seed Elo. */
export function teamPostMatches(
  post: { roles: string[]; language: string | null; division: string; minElo: number | null; maxElo: number | null },
  f: FindFilters
): boolean {
  if (f.division && post.division !== f.division) return false;
  if (f.language && post.language !== f.language) return false;
  if (f.role && !post.roles.includes(f.role)) return false;
  // Skill range: the team's wanted range must overlap the filter's.
  if (f.minElo !== null && post.maxElo !== null && post.maxElo < f.minElo) return false;
  if (f.maxElo !== null && post.minElo !== null && post.minElo > f.maxElo) return false;
  return true;
}

/** A free agent: `elo` is the player's main Elo (null = unranked). */
export function playerPostMatches(
  post: { roles: string[]; language: string | null; divisions: string[]; elo: number | null },
  f: FindFilters
): boolean {
  if (f.division && post.divisions.length && !post.divisions.includes(f.division)) return false;
  if (f.language && post.language !== f.language) return false;
  if (f.role && !post.roles.includes(f.role)) return false;
  if (f.minElo !== null && (post.elo ?? 0) < f.minElo) return false;
  if (f.maxElo !== null && (post.elo ?? 0) > f.maxElo) return false;
  return true;
}
