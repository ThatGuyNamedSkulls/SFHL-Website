import type { PrestigeProgress } from "@/lib/prestige";
import type { TierBenchmark, TrackOptions } from "@/lib/track";
import type { TrackRange } from "@/lib/track-link";
import type { Match, RankTierLetter } from "@/types";

/** GET /api/players/[name]/track */
export interface TrackData {
  player: {
    name: string;
    discordUsername: string | null;
    avatarUrl: string;
    rank: RankTierLetter;
    elo: number;
    peakElo: number;
    /** When this season's peak was reached (UTC), when known. */
    peakAt: string | null;
    placementDone: boolean;
    placementGamesPlayed: number;
    placementGamesTotal: number;
    prestige: PrestigeProgress;
    season: { number: number; label: string; startedAt: string | null };
  };
  range: TrackRange;
  filters: { map: string | null; mode: string | null };
  options: TrackOptions;
  /** "the 20 matches before", "last season", … — null for career. */
  compare: string | null;
  /** The range, newest first. */
  matches: Match[];
  /** The period before it (null when there is none). */
  previous: Match[] | null;
  truncated: boolean;
  /** Newest ranked matches, unfiltered (Today card, last session). */
  recent: Match[];
  placementMatches: Match[];
  benchmark: TierBenchmark | null;
}
