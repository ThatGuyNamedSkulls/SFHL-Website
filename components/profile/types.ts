import type { InventoryItem, Match, Player, ProfileCosmetics } from "@/types";
import type { PrestigeProgress } from "@/lib/prestige";

export interface ProfileFriend {
  name: string;
  avatar: string | null;
  rank: string;
  country: string | null;
  discordUsername?: string | null;
}

/** A teammate from GET /api/players/[name] (same match, same side). */
export interface PlayedWithEntry {
  name: string;
  count: number;
  wins: number;
  rank: string;
  country: string | null;
  discordUsername?: string | null;
  avatar?: string | null;
}

export interface ProfileTeam {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
  region: string;
  memberCount: number;
  maxMembers: number;
  /** "captain" or the roster role ("starter" / "sub" / "coach"). */
  role: string;
  titles: number;
  roster: { name: string; avatar: string | null }[];
}

export interface ProfileClan {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
  description: string;
  region: string;
  memberCount: number;
  ownerName?: string;
}

export interface ProfileModeRating {
  mode: string;
  elo: number;
  rank: string;
  peakElo: number;
  matchesPlayed: number;
  matchesWon: number;
  placementDone: boolean;
  placementGamesPlayed: number;
}

/** GET /api/players/[name]. */
export interface ProfilePlayer extends Player {
  playedWith?: PlayedWithEntry[];
  matchHistory?: Match[];
  hasMoreMatches?: boolean;
  regionFlag?: string;
  country?: string | null;
  countryName?: string | null;
  countryFlag?: string | null;
  cosmetics?: ProfileCosmetics;
  friends?: ProfileFriend[];
  inventory?: InventoryItem[];
  rankings?: { overall: number | null; country: number | null; region: number | null };
  discordUsername?: string | null;
  modes?: ProfileModeRating[];
  bio?: string | null;
  eloTimes?: (string | null)[];
  season?: { number: number; label: string; startedAt: string | null };
  seasonWins?: number;
  prestige?: PrestigeProgress;
  firstMatchAt?: string | null;
  lastMatchAt?: string | null;
  activity?: string[];
  teams?: ProfileTeam[];
  /** An active matchmaking ban (/player ban); `since` is ISO, or null if unknown. */
  ban?: { since: string | null } | null;
}

/** GET /api/players/[name]/stats. */
export interface ProfileStatsTotals {
  matches: number;
  wins: number;
  losses: number;
  winPercent: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kr: number | null;
  hsPercent: number;
  adr: number | null;
  mvpsPerMatch: number;
  eloSwing: number;
  eloChange: number;
}

export interface ProfileStats {
  scope: "season" | "career";
  season: { number: number; label: string; startedAt: string | null };
  totals: ProfileStatsTotals;
  longestWinStreak: number;
  cb: {
    matches: number;
    roundsPlayed: number;
    adr: number | null;
    firstKills: number;
    rounds2k: number;
    rounds3k: number;
    rounds4k: number;
    rounds5k: number;
  } | null;
  maps: (ProfileStatsTotals & { map: string })[];
}
