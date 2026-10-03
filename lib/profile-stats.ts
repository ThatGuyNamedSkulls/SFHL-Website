/**
 * Pure helpers for the profile page (docs/PROFILE_UI_PLAN.md): times, streaks
 * and totals over a list of matches. No database, no React — unit-tested in
 * tests/profile-stats.test.ts.
 */
import { RANK_TIERS, getRankByLetter } from "@/data/ranks";
import { avg, kdRatio, performanceRating, roundCount, swingPercent } from "@/lib/match-stats";
import type { Match, RankTier, RankTierLetter } from "@/types";

/**
 * Epoch ms for a database time. The bot writes UTC as "YYYY-MM-DD HH:MM:SS"
 * with no zone, which `new Date()` would read as LOCAL time — the profile
 * used to show every match an hour off in Portugal. Null when unparseable.
 */
export function parseDbTime(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00Z`
    : hasZone
      ? s.replace(" ", "T")
      : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** "Member since Jul 31, 2026" in the viewer's calendar, or null. */
export function formatMemberSince(raw: string | null | undefined): string | null {
  const ms = parseDbTime(raw);
  if (ms == null) return null;
  return `Member since ${new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** "Fri 2 Oct" and "17:38" in the viewer's own time zone. */
export function formatMatchWhen(raw: string | null | undefined): { day: string; time: string } {
  const ms = parseDbTime(raw);
  if (ms == null) return { day: raw ?? "", time: "" };
  const d = new Date(ms);
  return {
    day: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago", "4 months ago". */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return unit(m, "minute");
  const h = Math.round(m / 60);
  if (h < 24) return unit(h, "hour");
  const d = Math.round(h / 24);
  if (d < 31) return unit(d, "day");
  const mo = Math.round(d / 30.4);
  if (mo < 12) return unit(mo, "month");
  return unit(Math.round(d / 365), "year");
}

/** Local calendar day key ("2026-10-02") for grouping matches by day. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday" or "Fri 2 Oct" for a time, in the viewer's calendar. */
export function dayLabel(ms: number, now = Date.now()): string {
  const key = localDayKey(ms);
  if (key === localDayKey(now)) return "Today";
  if (key === localDayKey(now - 864e5)) return "Yesterday";
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** The run of equal results at the newest end (matches newest first). */
export function currentStreak(newestFirst: { result: string }[]): { result: "W" | "L"; count: number } | null {
  const first = newestFirst[0]?.result;
  if (first !== "W" && first !== "L") return null;
  let count = 0;
  for (const m of newestFirst) {
    if (m.result !== first) break;
    count++;
  }
  return { result: first, count };
}

/** Longest run of wins (any order of input: pass matches oldest first). */
export function longestWinStreak(oldestFirst: { result: string }[]): number {
  let best = 0;
  let run = 0;
  for (const m of oldestFirst) {
    run = m.result === "W" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Round count of a match: Counter Blox's own count, else its scoreline. */
export function roundsOf(m: Pick<Match, "rounds" | "roundsPlayed">): number | null {
  if (m.roundsPlayed != null && m.roundsPlayed > 0) return m.roundsPlayed;
  const raw = (m.rounds ?? "").replace(/\s/g, "");
  return raw ? roundCount(raw.replace(":", ",")) : null;
}

/** Damage per round with one decimal, or null when either side is missing. */
export function adrOf(damage: number | null | undefined, rounds: number | null | undefined): number | null {
  if (damage == null || !rounds || rounds <= 0) return null;
  return Math.round((damage / rounds) * 10) / 10;
}

/** The scoreboard rating estimate for one match (lib/match-stats.ts). */
export function matchRating(m: Match): number {
  return performanceRating({
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    rounds: roundsOf(m),
    score: m.score,
    mvps: m.mvps,
  });
}

export interface WindowTotals {
  matches: number;
  wins: number;
  losses: number;
  winPercent: number;
  /** Per-match averages. */
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  /** Kills per round over matches with a known round count; null without any. */
  kr: number | null;
  hsPercent: number;
  /** Damage per round over matches with damage and rounds; null without any. */
  adr: number | null;
  rating: number;
  /** Per match, oldest → newest (sparklines). */
  ratings: number[];
  /** Average rating swing vs the 1.10 baseline, in % (lib/match-stats.ts). */
  swing: number;
  swings: number[];
  /** 0–100: how steady the per-match K/D is. */
  consistency: number;
  /** Sum of the Elo changes, and its average per match. */
  eloChange: number;
  eloPerMatch: number;
  mvpsPerMatch: number;
  /** Totals over the window. */
  totalKills: number;
  totalMvps: number;
  /** Counter Blox's own scoreboard (/rank cbrm games only): how many matches
   *  have it, first kills per such match, and their totals. */
  scoreboardMatches: number;
  firstKillsPerMatch: number | null;
  firstKills: number;
  rounds2k: number;
  rounds3k: number;
  rounds4k: number;
  rounds5k: number;
}

/** Totals over a set of matches (any order; sparklines come out oldest → newest by date). */
export function windowTotals(list: Match[]): WindowTotals {
  const chrono = [...list].sort((a, b) => (parseDbTime(a.date) ?? 0) - (parseDbTime(b.date) ?? 0));
  const n = chrono.length;
  const sum = (f: (m: Match) => number) => chrono.reduce((s, m) => s + f(m), 0);
  const wins = chrono.filter((m) => m.result === "W").length;
  const ratings = chrono.map(matchRating);
  const withRounds = chrono.filter((m) => roundsOf(m) != null);
  const rounds = withRounds.reduce((s, m) => s + (roundsOf(m) ?? 0), 0);
  const withDamage = withRounds.filter((m) => m.damage != null);
  const damageRounds = withDamage.reduce((s, m) => s + (roundsOf(m) ?? 0), 0);
  const kds = chrono.map((m) => m.kdr);
  const meanKd = avg(kds);
  const sd = n > 1 ? Math.sqrt(kds.reduce((s, v) => s + (v - meanKd) ** 2, 0) / n) : 0;
  const rating = avg(ratings);
  const fkMatches = chrono.filter((m) => m.firstKills != null);
  const mk = chrono.filter((m) => m.multiKills != null);
  const mkSum = (k: "k2" | "k3" | "k4" | "k5") => mk.reduce((s, m) => s + (m.multiKills?.[k] ?? 0), 0);
  return {
    matches: n,
    wins,
    losses: n - wins,
    winPercent: n ? (wins / n) * 100 : 0,
    kills: n ? sum((m) => m.kills) / n : 0,
    deaths: n ? sum((m) => m.deaths) / n : 0,
    assists: n ? sum((m) => m.assists) / n : 0,
    kd: kdRatio(sum((m) => m.kills), sum((m) => m.deaths)),
    kr: rounds > 0 ? withRounds.reduce((s, m) => s + m.kills, 0) / rounds : null,
    hsPercent: avg(chrono.map((m) => m.headshotPercent || 0)),
    adr: damageRounds > 0 ? withDamage.reduce((s, m) => s + (m.damage ?? 0), 0) / damageRounds : null,
    rating,
    ratings,
    swing: n ? swingPercent(rating) : 0,
    swings: ratings.map(swingPercent),
    consistency: n > 1 ? Math.max(0, Math.min(100, 100 - sd * 60)) : 0,
    eloChange: sum((m) => m.eloChange || 0),
    eloPerMatch: n ? sum((m) => m.eloChange || 0) / n : 0,
    mvpsPerMatch: n ? sum((m) => m.mvps ?? 0) / n : 0,
    totalKills: sum((m) => m.kills),
    totalMvps: sum((m) => m.mvps ?? 0),
    scoreboardMatches: Math.max(fkMatches.length, mk.length),
    firstKillsPerMatch: fkMatches.length ? fkMatches.reduce((s, m) => s + (m.firstKills ?? 0), 0) / fkMatches.length : null,
    firstKills: fkMatches.reduce((s, m) => s + (m.firstKills ?? 0), 0),
    rounds2k: mkSum("k2"),
    rounds3k: mkSum("k3"),
    rounds4k: mkSum("k4"),
    rounds5k: mkSum("k5"),
  };
}

export interface TierProgress {
  tier: RankTier;
  next: RankTier | null;
  /** 0–100 through the current tier. */
  percent: number;
  /** Elo still needed for the next tier (null at the top). */
  toNext: number | null;
}

/** Where an Elo sits inside its skill tier and how far the next one is. */
export function tierProgress(rank: RankTierLetter, elo: number): TierProgress {
  const tier = getRankByLetter(rank);
  const idx = RANK_TIERS.findIndex((t) => t.letter === tier.letter);
  const next = tier.letter === "UNRANKED" ? null : RANK_TIERS[idx + 1] ?? null;
  const span = tier.maxElo + 1 - tier.minElo;
  const percent =
    tier.letter === "UNRANKED" ? 0 : Math.max(0, Math.min(100, ((elo - tier.minElo) / Math.max(1, span)) * 100));
  return { tier, next, percent, toNext: next ? Math.max(0, next.minElo - elo) : null };
}
