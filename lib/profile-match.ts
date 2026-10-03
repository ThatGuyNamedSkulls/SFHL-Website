/** match_history row → the Match the profile shows (summary, history, Load more). */
import { mapRank, type DbMatch } from "@/lib/db";
import { formatRoundScore, prettyMap, prettyRegion } from "@/lib/format";
import { roundCount } from "@/lib/match-stats";
import { getRankForElo } from "@/data/ranks";
import type { Match, RankTierLetter } from "@/types";

export function toProfileMatch(m: DbMatch, currentRank: string): Match {
  const eloBefore = m.elo_before == null ? undefined : Number(m.elo_before);
  const eloAfter = eloBefore == null ? undefined : eloBefore + Number(m.elo_change || 0);
  // The rank stored with the row is the post-result one; rows from before the
  // bot stored it use the Elo after the match, then the player's current rank.
  const rank = (
    m.player_rank
      ? mapRank(m.player_rank)
      : eloAfter != null && eloAfter > 0
        ? getRankForElo(eloAfter).letter
        : mapRank(currentRank)
  ) as RankTierLetter;
  const rounds = m.rounds_played != null ? Number(m.rounds_played) : roundCount(m.round_score);
  return {
    id: `M-${m.id}`,
    rowId: Number(m.id),
    date: m.timestamp || "",
    region: prettyRegion(m.region),
    map: prettyMap(m.map_name),
    mode: "Competitive",
    result: m.result as "W" | "L",
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    kdr: m.deaths > 0 ? +(m.kills / m.deaths).toFixed(2) : m.kills,
    headshotPercent: m.hs_percentage,
    eloChange: m.elo_change,
    score: m.points,
    rounds: formatRoundScore(m.round_score, m.result),
    mvp: (m.mvps || 0) > 0,
    matchId: m.match_id ?? undefined,
    mvps: m.mvps || 0,
    isSub: Number(m.is_sub) === 1,
    leftEarly: Number(m.left_early) === 1,
    subShare: m.sub_share == null ? null : Number(m.sub_share),
    rank,
    elo: eloBefore,
    eloAfter,
    damage: m.damage == null ? null : Number(m.damage),
    roundsPlayed: rounds && rounds > 0 ? rounds : null,
    gameMode: m.mode ? String(m.mode) : null,
    firstKills: m.first_kills == null ? null : Number(m.first_kills),
    multiKills:
      m.rounds_2k == null
        ? null
        : {
            k2: Number(m.rounds_2k) || 0,
            k3: Number(m.rounds_3k) || 0,
            k4: Number(m.rounds_4k) || 0,
            k5: Number(m.rounds_5k) || 0,
          },
  };
}
