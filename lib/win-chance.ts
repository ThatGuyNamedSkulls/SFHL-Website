/**
 * Pre-match team win chance. Same formula as the bot's expected_score
 * (config/games/counterstrike.toml: divisor 400, e_compress 0.7).
 *
 * A player with no rating yet (never played, or a 0 on record) counts as the
 * perceived seed (placement.start_elo = 1200), never as 0.
 */

const DIVISOR = 400;
const COMPRESS = 0.7;
const SEED_ELO = 1200;

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
  /** Fraction of the match this player was on the server (subs and leavers). */
  sub_share?: number | null;
};

function ratingOf(player: SideRow): number {
  const skill = Number(player.skill ?? 0);
  if (skill > 0) return skill;
  return preMatchElo(player.elo_before);
}

/** Average pre-match rating for one side, counted per roster SLOT like the
 *  bot: a sub and the player they replaced are weighted by how much of the
 *  match each played (their two sub_share values add up to one slot). Rows
 *  without a share fall back to dropping the leaver. */
export function sideAverage(players: SideRow[]): number | null {
  if (players.length === 0) return null;
  const inSlot = (p: SideRow) => Number(p.is_sub) === 1 || Number(p.left_early) === 1;
  const shared = players.filter(inSlot);
  if (shared.length > 0 && shared.every((p) => p.sub_share != null && Number(p.sub_share) > 0)) {
    let sum = 0;
    let weight = 0;
    for (const p of players) {
      const w = inSlot(p) ? Number(p.sub_share) : 1;
      sum += ratingOf(p) * w;
      weight += w;
    }
    return weight > 0 ? sum / weight : null;
  }
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

/** The win chance the bot froze onto the history rows when the match was
 *  ranked, or null for rows written before it did. */
export function storedWinChances(
  teamA: { win_chance?: number | null }[],
  teamB: { win_chance?: number | null }[]
): { teamA: number; teamB: number } | null {
  const pick = (rows: { win_chance?: number | null }[]) => {
    const row = rows.find((r) => r.win_chance != null && Number.isFinite(Number(r.win_chance)));
    return row ? Math.round(Number(row.win_chance)) : null;
  };
  const a = pick(teamA);
  const b = pick(teamB);
  if (a != null) return { teamA: a, teamB: b ?? 100 - a };
  if (b != null) return { teamA: 100 - b, teamB: b };
  return null;
}
