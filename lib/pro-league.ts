/**
 * Pro ladder from league matches (docs/LEAGUE_V2_PLAN.md, Part A). The bot
 * computes it (core/pro_league.py); the website only shows it. Same weights
 * as DIVISION_WEIGHTS there — tests/pro-league.test.ts checks they match.
 */

export const PRO_DIVISION_WEIGHTS: Record<string, number> = {
  open10: 1.0,
  entry: 1.1,
  intermediate: 1.2,
  main: 1.3,
  advanced: 1.4,
  pro: 1.5,
};

/** A division's Pro weight, or null when its matches don't count (below Open10). */
export function proDivisionWeight(code: string | null | undefined): number | null {
  if (!code) return null;
  const weights = code
    .split("+")
    .filter((c) => c in PRO_DIVISION_WEIGHTS)
    .map((c) => PRO_DIVISION_WEIGHTS[c]);
  return weights.length ? Math.min(...weights) : null;
}
