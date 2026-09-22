/** Shared tournament shapes. Safe to import from client components. */

export type TournamentKind = "official" | "community";
export type TournamentStatus = "open" | "live" | "completed" | "cancelled";
export type BracketKind = "single" | "double";
export type SeriesLength = 1 | 3;
export type FieldSize = 8 | 16;
export type RosterRole = "captain" | "starter" | "sub";
export type RosterStatus = "invited" | "accepted";
export type MatchSide = "winners" | "losers" | "grand";
export type MatchStatus = "pending" | "ready" | "completed";

export interface RosterMember {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: RosterRole;
  status: RosterStatus;
}

export interface TournamentTeam {
  id: string;
  name: string;
  captainId: string;
  paidAmount: number;
  paidBy: string | null;
  seed: number;
  placement: number | null;
  prizeCredited: boolean;
  members: RosterMember[];
}

export interface JoinRequest {
  id: string;
  teamName: string;
  captainId: string;
  captainName: string;
  playerName: string;
  avatar: string | null;
  status: "pending" | "denied";
  /** Coins already taken for this request. Missing on requests made before fees were charged up front. */
  paidAmount?: number;
  paidBy?: string | null;
  createdAt: number;
}

export interface MapScore {
  map: string;
  scoreA: number;
  scoreB: number;
}

export interface BracketMatch {
  id: string;
  side: MatchSide;
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
  teamASet: boolean;
  teamBSet: boolean;
  scores: MapScore[];
  winnerId: string | null;
  status: MatchStatus;
  nextMatchId: string | null;
  nextSlot: "A" | "B" | null;
  loserMatchId: string | null;
  loserSlot: "A" | "B" | null;
}

export interface Tournament {
  id: string;
  name: string;
  kind: TournamentKind;
  clubId: string | null;
  region: string;
  bracket: BracketKind;
  size: FieldSize;
  bo: SeriesLength;
  entryFee: number;
  pot: number;
  potSplit: [number, number, number];
  mapPool: string[];
  status: TournamentStatus;
  createdBy: string;
  paidOut: boolean;
  requests: JoinRequest[];
  teams: TournamentTeam[];
  matches: BracketMatch[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_POT_SPLIT: [number, number, number] = [60, 30, 10];
