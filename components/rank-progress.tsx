"use client";

import { RankTierLetter } from "@/types";
import { getRankByLetter, getNextRank } from "@/data/ranks";
import { RankBadge } from "@/components/rank-badge";

interface RankProgressProps {
  elo: number;
  rank: RankTierLetter;
  placementDone?: boolean;
  placementGamesPlayed?: number;
}

/**
 * FACEIT-style rank/Elo widget: current tier badge, Elo, and a progress bar
 * showing how far the player is through their tier toward the next rank.
 */
export function RankProgress({
  elo,
  rank,
  placementDone,
  placementGamesPlayed = 0,
}: RankProgressProps) {
  // Placement / unranked players see placement progress instead of an Elo bar.
  if (rank === "UNRANKED" || placementDone === false) {
    const pct = Math.min((placementGamesPlayed / 3) * 100, 100);
    return (
      <div className="flex items-center gap-4">
        <RankBadge rank="UNRANKED" size="md" />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold text-white">
              Placement Matches
            </span>
            <span className="text-xs text-hl-muted">
              {Math.min(placementGamesPlayed, 3)}/3 played
            </span>
          </div>
          <div className="w-full bg-hl-base rounded-full h-2.5">
            <div
              className="bg-gold-gradient h-2.5 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-hl-muted mt-1.5">
            Finish {3 - Math.min(placementGamesPlayed, 3)} more match
            {3 - placementGamesPlayed === 1 ? "" : "es"} to get ranked.
          </div>
        </div>
      </div>
    );
  }

  const tier = getRankByLetter(rank);
  const next = getNextRank(rank);
  const span = Math.max(tier.maxElo - tier.minElo, 1);
  const into = elo - tier.minElo;
  const pct = next ? Math.max(0, Math.min((into / span) * 100, 100)) : 100;
  const toNext = next ? Math.max(next.minElo - elo, 0) : 0;

  return (
    <div className="flex items-center gap-4">
      <RankBadge rank={rank} size="md" />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-white">
            Tier {tier.name}
          </span>
          <span className="text-xs text-hl-muted">
            {next ? (
              <>
                <span className="text-hl-gold font-semibold">{toNext}</span> ELO to{" "}
                {next.name === "★" ? "★ (Star)" : `Tier ${next.name}`}
              </>
            ) : (
              <span className="text-hl-gold font-semibold">Top tier reached</span>
            )}
          </span>
        </div>
        <div className="w-full bg-hl-base rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-gold-gradient h-2.5 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-hl-muted mt-1.5">
          <span>{next ? tier.minElo : "2500"}</span>
          <span className="stat-number text-white">{elo} ELO</span>
          <span>{next ? next.minElo : "∞"}</span>
        </div>
      </div>
    </div>
  );
}
