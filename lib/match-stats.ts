/** Scoreboard Rating / Swing.
 *
 *  FACEIT Rating and Round Swing are unpublished win-probability metrics that
 *  need per-round events (alive counts, economy, bomb, damage share). We do
 *  not store any of that — only K/D/A, score, MVPs, and the match round total.
 *
 *  These numbers are a FACEIT-scaled estimate from that scoreboard. They are
 *  not FACEIT's model, not HLTV 3.0, and they do not affect Elo.
 *
 *  Anchors (FACEIT's published display scale): 1.4 advanced, 1.1 average, 0.7
 *  below average. TYPICAL_SPR (~60 score over 24 rounds) is the one knob to
 *  retune if live scores sit on a different scale — do not invent ADR.
 */

export const RATING_BASELINE = 1.1;
export const SWING_SCALE = 20;
export const TYPICAL_SPR = 2.5;
export const RATING_MIN = 0.2;
export const RATING_MAX = 2.5;
export const RATING_GREAT = 1.4;
export const SWING_GOOD = 0.05;
/** Extra-good / gold swing. */
export const SWING_GREAT = 9;

export const STAT_ESTIMATE_HINT = "Estimate from scoreboard stats (no demo).";

export type PerformanceInputs = {
  kills: number;
  deaths: number;
  assists: number;
  rounds?: number | null;
  score?: number | null;
  mvps?: number | null;
};

export function parseRoundScore(raw: string | null | undefined): {
  first: number;
  second: number;
  total: number;
} | null {
  if (!raw) return null;
  const nums = raw
    .split(/[,:]/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  return { first: nums[0], second: nums[1], total: Math.max(1, nums[0] + nums[1]) };
}

export function roundCount(raw: string | null | undefined): number | null {
  return parseRoundScore(raw)?.total ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampRating(n: number): number {
  return round2(Math.min(RATING_MAX, Math.max(RATING_MIN, n)));
}

/** Scoreboard estimate centred near FACEIT's 1.10 platform average. */
export function performanceRating(input: PerformanceInputs): number {
  const kills = input.kills || 0;
  const deaths = input.deaths || 0;
  const assists = input.assists || 0;
  const rounds = input.rounds;
  const score = input.score ?? 0;
  const mvps = input.mvps ?? 0;

  if (rounds && rounds > 0) {
    const kpr = kills / rounds;
    const dpr = deaths / rounds;
    const apr = assists / rounds;
    const mpr = mvps / rounds;
    const spr = score / rounds;
    return clampRating(
      0.95 * kpr +
        0.28 * apr -
        0.38 * dpr +
        0.35 * mpr +
        0.04 * (spr / TYPICAL_SPR) +
        0.58
    );
  }

  const kd = deaths > 0 ? kills / deaths : kills;
  return clampRating(0.45 * kd + 0.12 * (assists / Math.max(deaths, 1)) + 0.65);
}

export function killsPerRound(kills: number, rounds: number | null): number | null {
  if (!rounds || rounds <= 0) return null;
  return round2(kills / rounds);
}

/** Signed percent vs the 1.10 baseline. A 1.40 game is +6.00%. */
export function swingPercent(rating: number): number {
  return round2((rating - RATING_BASELINE) * SWING_SCALE);
}

export function kdRatio(kills: number, deaths: number): number {
  return round2(deaths > 0 ? kills / deaths : kills);
}

export function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const COLOR_GOLD = "#ffc44d";
const COLOR_GREEN = "#2ecc71";
const COLOR_RED = "#e74c3c";
const COLOR_NEUTRAL = "#8a8a8a";
const COLOR_WHITE = "#e8e8e8";
const COLOR_ORANGE = "#ff5500";

export function ratingColor(rating: number): string {
  if (rating >= RATING_GREAT) return COLOR_ORANGE;
  if (rating >= 1.25) return COLOR_GREEN;
  if (rating >= 0.8) return COLOR_WHITE;
  return COLOR_RED;
}

/** Positive = green, extra-good (≥ +9%) = gold. */
export function swingColor(swing: number): string {
  if (swing >= SWING_GREAT) return COLOR_GOLD;
  if (swing > SWING_GOOD) return COLOR_GREEN;
  if (swing < -SWING_GOOD) return COLOR_RED;
  return COLOR_NEUTRAL;
}

export function eloChangeColor(delta: number): string {
  if (delta > 0) return COLOR_GREEN;
  if (delta < 0) return COLOR_RED;
  return COLOR_NEUTRAL;
}

export function formatSigned(n: number, digits?: number): string {
  const body = digits != null ? n.toFixed(digits) : String(Math.round(n));
  return n > 0 ? `+${body}` : body;
}

export function teamHandle(name: string | null | undefined): string {
  const slug = (name || "team").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `team_${slug || "team"}`;
}
