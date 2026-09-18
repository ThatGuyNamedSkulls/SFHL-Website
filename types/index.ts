/* ============================================================
   HyperLeague — Core Type Definitions
   ============================================================ */

/** Rank tier letters matching the real SFHL 10-tier system */
export type RankTierLetter =
  | "D"
  | "C"
  | "B"
  | "A1"
  | "A2"
  | "A3"
  | "S1"
  | "S2"
  | "S3"
  | "STAR"
  | "UNRANKED";

export interface RankTier {
  letter: RankTierLetter;
  name: string;
  /** The full label as stored in the DB, e.g. "[D | 1-799]" */
  dbName: string;
  minElo: number;
  maxElo: number;
  color: string;
  glowClass: string;
}

/** Region codes */
export type Region = "NA" | "EU" | "SA" | "APAC" | "OC" | "EU-West-2";

/** Game modes */
export type GameMode = "Competitive" | "Ranked" | "Casual";

/** Match result */
export type MatchResult = "W" | "L";

/** Map definition */
export interface GameMap {
  id: string;
  name: string;
}

/** Player stats */
export interface PlayerStats {
  wins: number;
  losses: number;
  matchesPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotPercent: number;
  kd: number;
  winPercent: number;
  scorePerGame: number;
  avgMvp: number;
  playtimeHours: number;
}

/** Player profile */
export interface Player {
  id: string;
  username: string;
  avatarUrl: string;
  rank: RankTierLetter;
  elo: number;
  peakElo: number;
  region: Region;
  stats: PlayerStats;
  /** ELO oldest → newest. A `null` marks a season boundary (the line breaks
   *  there — past seasons are kept, the new season restarts to its right). */
  eloHistory: (number | null)[];
  /** Season resets: index of each break in eloHistory + the season's name. */
  eloResets?: { index: number; label: string }[];
  /** Lifetime match count (not reset with the season). */
  careerMatchesPlayed?: number;
  /** Ranked matches in the current season. */
  seasonMatchesPlayed?: number;
  seasonWinPercent?: number;
  lastResetAt?: string | null;
  lastSeason?: { name: string; elo: number; rank: RankTierLetter } | null;
  joinedDate: string;
  placementDone?: boolean;
  placementGamesPlayed?: number;
  placementGamesTotal?: number;
  placementMatches?: Match[];
}

/** Cosmetic item types (profile customization inventory). */
export type CosmeticType = "card" | "title" | "badge" | "frame";

/** An owned cosmetic item, as returned by /api/inventory. */
export interface InventoryItem {
  id: number;
  slug: string;
  type: CosmeticType;
  name: string;
  description: string;
  asset: string | null;
  category: string | null;
  season: string | null;
  rarity: string;
  grantedAt: number;
  equipped: boolean;
}

/** A purchasable shop item (catalog item with price > 0). */
export interface ShopItem {
  id: number;
  slug: string;
  type: CosmeticType;
  name: string;
  description: string;
  asset: string | null;
  rarity: string;
  price: number;
  owned: boolean;
}

/** Equipped cosmetics rendered on a public profile. */
export interface ProfileCosmetics {
  card: { slug: string; name: string; asset: string | null } | null;
  /** Decorative ring PNG rendered around the avatar. */
  frame: { slug: string; name: string; asset: string | null } | null;
  title: string | null;
  badges: { slug: string; name: string; description: string; asset: string | null }[];
}

/** Single match record */
export interface Match {
  id: string;
  date: string;
  region: string;
  map: string;
  mode: GameMode;
  result: MatchResult;
  kills: number;
  deaths: number;
  assists: number;
  kdr: number;
  headshotPercent: number;
  eloChange: number;
  score: number;
  rounds: string;
  mvp: boolean;
  matchId?: number;
  mvps?: number;
  isSub?: boolean;
  leftEarly?: boolean;
  subShare?: number | null;
  /** Skill rank at the time of this match. */
  rank?: RankTierLetter;
  /** Elo the player had when this match started. */
  elo?: number;
}

/** Tournament status */
export type TournamentStatus = "upcoming" | "live" | "completed";

/** Tournament */
export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  prizePool: string;
  teams: number;
  maxTeams: number;
  format: string;
  region: Region;
  startDate: string;
  mapPool: string[];
}

/** Leaderboard entry */
export interface LeaderboardEntry {
  position: number;
  player: Player;
  trend: "up" | "down" | "stable";
  trendDelta: number;
}

/** ELO history data point for Recharts */
export interface EloDataPoint {
  match: number;
  elo: number;
  date: string;
}

/* ============================================================
   V2 Types — Match Details, Brackets, Rounds
   ============================================================ */

/** Individual player's performance in a single match */
export interface MatchPlayerStats {
  playerId: string;
  username: string;
  avatarUrl?: string;
  rank: RankTierLetter;
  team: "A" | "B";
  kills: number;
  deaths: number;
  assists: number;
  kdr: number;
  headshotPercent: number;
  score: number;
  mvp: boolean;
  eloChange: number;
  firstKills: number;
  clutches: number;
  plants: number;
  defuses: number;
  elo?: number;
  country?: string | null;
  countryFlag?: string | null;
  rating?: number;
  swing?: number;
  kpr?: number | null;
  mvps?: number;
  /** This row is a substitute appearance. */
  isSub?: boolean;
  /** This row is the player who left mid-match. */
  leftEarly?: boolean;
  /** Fraction of the match this player was present for (drives the SUB · 58% tag). */
  subShare?: number | null;
}

/** Detailed match with full scoreboard and round-by-round data */
export interface MatchDetail {
  id: string;
  date: string;
  timestamp?: string;
  region: string;
  map: string;
  mode: GameMode | string;
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
  /** Whether the headline score is the real round score or a fallback point sum. */
  scoreType?: "rounds" | "points";
  winner: "A" | "B";
  teamARoundsFirstHalf: number;
  teamBRoundsFirstHalf: number;
  teamARoundsSecondHalf: number;
  teamBRoundsSecondHalf: number;
  players: MatchPlayerStats[];
  rounds: RoundEvent[];
  duration: string;
  mapVeto?: MapVeto[];
  modeLabel?: string;
  teamAAvatar?: string;
  teamBAvatar?: string;
}

/** Round-by-round event */
export interface RoundEvent {
  roundNumber: number;
  winner: "A" | "B";
  winCondition: "elimination" | "defuse" | "detonation" | "timeout";
  highlight?: string;
}

/** Map veto entry */
export interface MapVeto {
  team: string;
  action: "ban" | "pick" | "decider";
  map: string;
}

/** Tournament bracket match */
export interface BracketMatch {
  id: string;
  round: number;
  position: number;
  teamA: string | null;
  teamB: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  status: "upcoming" | "live" | "completed";
  scheduledTime?: string;
  map?: string;
}

/** Full bracket structure */
export interface Bracket {
  tournamentId: string;
  type: "single" | "double";
  rounds: BracketRound[];
}

/** A round within a bracket */
export interface BracketRound {
  name: string;
  matches: BracketMatch[];
}

/* ============================================================
   Party Finder
   ============================================================ */

export interface PartyMemberView {
  discordId: string;
  username: string;
  playerName: string | null;
  /** Discord @handle for "name (@handle)" display. */
  discordUsername?: string | null;
  avatar: string | null;
  rank: string;
  elo: number;
  country: string | null;
  /** Equipped profile-card art, shown as the member slot background. */
  card?: string | null;
  /** Equipped avatar-frame art, rendered around the avatar. */
  frame?: string | null;
  /** Live guild-membership check (null when it can't be determined). */
  verified?: boolean | null;
  /** Whether this member currently meets the queue requirements. */
  canQueue?: boolean;
}

export interface PartyView {
  id: string;
  name: string;
  game: string;
  gameMode: string;
  matchType: string;
  region: string;
  leaderId: string;
  members: PartyMemberView[];
  maxSize: number;
  minSkill: string;
  maxSkill: string;
  language: string;
  countries: string;
  verifiedOnly: boolean;
  voiceRequired: boolean;
  isPrivate?: boolean;
  /** Vibe tag (Chill / Fun / Balanced / Serious / Intense). */
  vibe?: string;
  /** Player names this party has pending invites out to (members' view only). */
  invitedNames?: string[];
  createdAt: number;
  updatedAt: number;
  voiceChannelId?: string | null;
  voiceChannelUrl?: string | null;
  guildId?: string | null;
}

/**
 * One open substitute slot: a live match whose player left, waiting for
 * someone to finish it. Written by the bot (`sub_requests`), served by
 * /api/subs, and annotated per viewer with whether they can claim it.
 */
export interface SubRequestView {
  id: number;
  /** Discord match channel id, which is also the lobby id. */
  channelId: string;
  guildId: string | null;
  region: string | null;
  mode: string | null;
  /** Which side is short-handed (1 or 2). */
  team: number;
  map: string;
  /** The player being replaced. */
  leaver: string;
  /** Their Elo — the centre of the band a claimer must fall inside. */
  targetElo: number | null;
  /** Round score when they left, e.g. "7,4". */
  swapScore: string | null;
  openedAt: number;
  openSeconds: number;
  /** Elo band around `targetElo` right now; null once open to everyone. */
  band: number | null;
  eligible: boolean;
  /** Why not, when `eligible` is false. */
  reason: string | null;
  /** Seconds until the widening band admits this viewer, if that's the blocker. */
  eligibleInSeconds: number | null;
  /** Discord deep link to the match channel. */
  channelUrl: string | null;
}

/** Auth session stored in cookie */
export interface UserSession {
  discordId: string;
  /** Discord display name (the "roblox username" the bot keys players on). */
  username: string;
  /** Discord @handle, shown as "username (@discordUsername)". */
  discordUsername?: string | null;
  avatar: string | null;
  discriminator: string;
  /** Player name in the SFHL database (matched by Discord username) */
  playerName: string | null;
  /** Whether the user is a member of the SFHL guild */
  inGuild: boolean;
  /** Whether they have the Bloxlink verified role in the guild. */
  verified?: boolean;
}
