/**
 * Elo timeline reconstruction, season-aware.
 *
 * The profile graph has no stored per-match Elo — only each match's `elo_change`
 * — so the curve is rebuilt by walking BACKWARDS from a known anchor. Using the
 * player's *current* Elo as the sole anchor breaks the moment a season is reset:
 * the reset drops everyone to 0, so subtracting last season's gains marched the
 * whole history into negative numbers.
 *
 * Instead we split the matches at each season boundary (`season_resets.reset_at`)
 * and anchor every segment to the Elo that season actually *ended* on — which
 * /resetdb archives into `season_stats` before zeroing the live columns. Past
 * seasons therefore keep their real values, and the new season starts fresh to
 * the right of the boundary. The boundary indices are returned so the chart can
 * draw a "Season reset" divider there.
 */

export interface EloChange {
  eloChange: number;
  /** UTC "YYYY-MM-DD HH:MM:SS" (same format as season_resets.reset_at). */
  timestamp: string;
}

export interface SeasonBoundary {
  season_name: string;
  reset_at: string;
}

export interface EloTimeline {
  /** Elo values, oldest → newest. A `null` marks a season boundary: the old
   *  season's final Elo and the new season's starting Elo are unrelated values,
   *  so the line is broken there rather than drawn as a plunge to zero. */
  history: (number | null)[];
  /** Where a season ended: the index of the break + the season's name. */
  resets: { index: number; label: string }[];
}

/**
 * Rebuild one segment's Elo points from its end anchor.
 * Given changes oldest→newest [c1..cn] and the Elo the segment ENDED on, the
 * points are [E - Σc, ..., E - cn, E] (n + 1 values).
 */
function segmentPoints(changes: number[], endElo: number): number[] {
  const points: number[] = new Array(changes.length + 1);
  points[changes.length] = endElo;
  for (let i = changes.length - 1; i >= 0; i--) {
    points[i] = points[i + 1] - changes[i];
  }
  return points;
}

/**
 * Build the season-aware Elo curve.
 *
 * @param currentElo    the player's live Elo (anchors the CURRENT season)
 * @param changesNewestFirst  elo_change + timestamp, newest first (as the API returns)
 * @param resets        season resets, oldest first
 * @param seasonFinalElos  season_name → that season's archived final Elo
 */
export function buildEloTimeline(
  currentElo: number,
  changesNewestFirst: EloChange[],
  resets: SeasonBoundary[],
  seasonFinalElos: Map<string, number>
): EloTimeline {
  const changes = [...changesNewestFirst].reverse(); // oldest → newest

  // No reset has ever happened: the original single-anchor reconstruction is
  // correct (and cheapest).
  if (resets.length === 0) {
    return { history: segmentPoints(changes.map((c) => c.eloChange), currentElo), resets: [] };
  }

  // Bucket each match into the season it belongs to: the first reset that
  // happened AFTER it. Matches after the last reset are the current season.
  const buckets: EloChange[][] = resets.map(() => []);
  const current: EloChange[] = [];
  for (const c of changes) {
    const idx = resets.findIndex((r) => c.timestamp && c.timestamp < r.reset_at);
    if (idx === -1) current.push(c);
    else buckets[idx].push(c);
  }

  const history: (number | null)[] = [];
  const markers: { index: number; label: string }[] = [];

  resets.forEach((reset, i) => {
    const seg = buckets[i];
    if (seg.length === 0) return; // player didn't play that season — no segment
    const deltas = seg.map((c) => c.eloChange);
    // Anchor on the Elo that season ENDED on. If it wasn't archived (player
    // missing from season_stats), fall back to assuming they started at 0.
    const endElo =
      seasonFinalElos.get(reset.season_name) ??
      deltas.reduce((a, b) => a + b, 0);
    history.push(...segmentPoints(deltas, endElo));
    // Break the line at the boundary: the next season restarts from a fresh
    // Elo, so joining the two would draw a meaningless cliff.
    markers.push({ index: history.length, label: reset.season_name });
    history.push(null);
  });

  // Current season, anchored on the live Elo. Its own start point is kept — it
  // IS the post-reset starting Elo (0 until placements graduate them).
  if (current.length > 0 || history.length === 0) {
    history.push(...segmentPoints(current.map((c) => c.eloChange), currentElo));
  }

  return { history, resets: markers };
}
