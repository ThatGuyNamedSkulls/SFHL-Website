/**
 * Pre-match team win chance. Same formula as the bot's expected_score
 * (config/games/counterstrike.toml: divisor 400, e_compress 0.7).
 *
 * A player with no stored pre-match Elo counts as the placement seed (1000),
 * which is how an unrated player is treated before their first game.
 */

const DIVISOR = 400;
const COMPRESS = 0.7;
const SEED_ELO = 1000;

export function preMatchElo(eloBefore: number | null | undefined): number {
  const elo = Number(eloBefore ?? 0);
  return elo > 0 ? elo : SEED_ELO;
}

/** Rating the Elo math uses. Ranked players use their real Elo. A player still
 *  in placements uses the hidden placement rating (mmr), never shown as Elo. */
export function perceivedSkill(input: {
  placementDone: boolean;
  elo?: number | null;
  mmr?: number | null;
  eloBefore?: number | null;
}): number {
  if (input.placementDone) {
    const before = Number(input.eloBefore ?? input.elo ?? 0);
    return before > 0 ? before : SEED_ELO;
  }
  const mmr = Number(input.mmr ?? 0);
  if (mmr > 0) return mmr;
  const stored = Number(input.elo ?? 0);
  if (stored > 0) return stored;
  const before = Number(input.eloBefore ?? 0);
  return before > 0 ? before : SEED_ELO;
}

export function expectedWinChance(teamAvg: number, oppAvg: number): number {
  const raw = 1 / (1 + 10 ** ((oppAvg - teamAvg) / DIVISOR));
  const compressed = 0.5 + (raw - 0.5) * COMPRESS;
  return Math.max(0, Math.min(100, Math.round(compressed * 100)));
}

type SideRow = {
  elo_before?: number | null;
  /** Perceived rating used in the average. Falls back to elo_before. */
  skill?: number | null;
  is_sub?: number;
  left_early?: number;
};

function ratingOf(player: SideRow): number {
  const skill = Number(player.skill ?? 0);
  if (skill > 0) return skill;
  return preMatchElo(player.elo_before);
}

/** Average pre-match Elo for one side. A sub replaces the leaver, so the
 *  leaver is not counted twice when a substitute row is present. */
export function sideAverage(players: SideRow[]): number | null {
  if (players.length === 0) return null;
  const hasSub = players.some((p) => Number(p.is_sub) === 1);
  const counted = hasSub ? players.filter((p) => Number(p.left_early) !== 1) : players;
  const list = counted.length > 0 ? counted : players;
  const sum = list.reduce((acc, p) => acc + ratingOf(p), 0);
  return sum / list.length;
}

export function teamWinChances(
  teamA: SideRow[],
  teamB: SideRow[]
): { teamA: number; teamB: number } | null {
  const avgA = sideAverage(teamA);
  const avgB = sideAverage(teamB);
  if (avgA == null || avgB == null) return null;
  const a = expectedWinChance(avgA, avgB);
  return { teamA: a, teamB: 100 - a };
}
