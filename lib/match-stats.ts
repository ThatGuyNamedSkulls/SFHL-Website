/** Performance numbers we can compute from stored K/D/A + round score.
 *
 *  HyperLeague does not store damage, multi-kills, or KAST. Rating is a
 *  kills-per-round style index centred near 1.00 so the matchroom and profile
 *  can show FACEIT-like cards without inventing ADR.
 */

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

/** ~1.00 for a typical 20/20 game over a 24-round match. */
export function performanceRating(
  kills: number,
  deaths: number,
  assists: number,
  rounds: number | null
): number {
  if (rounds && rounds > 0) {
    const kpr = kills / rounds;
    const dpr = deaths / rounds;
    const apr = assists / rounds;
    return Math.max(0.01, round2(kpr * 1.05 + apr * 0.35 - dpr * 0.32 + 0.48));
  }
  const kd = deaths > 0 ? kills / deaths : kills;
  return Math.max(0.01, round2(0.45 * kd + 0.12 * (assists / Math.max(deaths, 1)) + 0.3));
}

export function killsPerRound(kills: number, rounds: number | null): number | null {
  if (!rounds || rounds <= 0) return null;
  return round2(kills / rounds);
}

/** Percent the player's rating sits above/below their team's average. */
export function swingPercent(rating: number, teamAvg: number): number {
  if (!teamAvg) return 0;
  return round2(((rating - teamAvg) / teamAvg) * 100);
}

export function kdRatio(kills: number, deaths: number): number {
  return round2(deaths > 0 ? kills / deaths : kills);
}

export function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function ratingColor(rating: number): string {
  if (rating >= 1.3) return "#ff5500";
  if (rating >= 1.0) return "#2ecc71";
  if (rating >= 0.8) return "#e8e8e8";
  return "#e74c3c";
}

export function swingColor(swing: number): string {
  if (swing > 0.05) return "#2ecc71";
  if (swing < -0.05) return "#e74c3c";
  return "#8a8a8a";
}

export function teamHandle(name: string | null | undefined): string {
  const slug = (name || "team").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `team_${slug || "team"}`;
}
