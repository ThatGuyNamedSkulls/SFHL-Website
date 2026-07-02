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
export type Region = "NA" | "EU" | "APAC" | "EU-West-2";

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
  eloHistory: number[];
  joinedDate: string;
  placementDone?: boolean;
  placementGamesPlayed?: number;
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
}

/** Detailed match with full scoreboard and round-by-round data */
export interface MatchDetail {
  id: string;
  date: string;
  region: string;
  map: string;
  mode: GameMode;
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
  avatar: string | null;
  rank: string;
  elo: number;
  country: string | null;
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
  createdAt: number;
  updatedAt: number;
}

/** Auth session stored in cookie */
export interface UserSession {
  discordId: string;
  username: string;
  avatar: string | null;
  discriminator: string;
  /** Player name in the SFHL database (matched by Discord username) */
  playerName: string | null;
  /** Whether the user is a member of the SFHL guild */
  inGuild: boolean;
}
