import type { Bracket, BracketMatch as ViewMatch } from "@/types";
import type {
  BracketKind,
  BracketMatch,
  FieldSize,
  MatchSide,
  MapScore,
} from "@/lib/tournament-types";

function matchKey(side: MatchSide, round: number, position: number) {
  return `${side}-${round}-${position}`;
}

function blank(side: MatchSide, round: number, position: number): BracketMatch {
  return {
    id: matchKey(side, round, position),
    side,
    round,
    position,
    teamAId: null,
    teamBId: null,
    teamASet: false,
    teamBSet: false,
    scores: [],
    winnerId: null,
    status: "pending",
    nextMatchId: null,
    nextSlot: null,
    loserMatchId: null,
    loserSlot: null,
  };
}

/** 1-indexed seeds in first-round slot order: 1 vs size, etc. */
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  const prev = seedOrder(size / 2);
  const out: number[] = [];
  for (const seed of prev) out.push(seed, size + 1 - seed);
  return out;
}

function findMatch(matches: BracketMatch[], id: string | null): BracketMatch | null {
  if (!id) return null;
  return matches.find((m) => m.id === id) ?? null;
}

function loserOf(match: BracketMatch): string | null {
  if (!match.winnerId || !match.teamAId || !match.teamBId) return null;
  return match.winnerId === match.teamAId ? match.teamBId : match.teamAId;
}

function advance(matches: BracketMatch[], match: BracketMatch) {
  if (match.nextMatchId && match.nextSlot) {
    fill(matches, match.nextMatchId, match.nextSlot, match.winnerId);
  }
  if (match.loserMatchId && match.loserSlot) {
    fill(matches, match.loserMatchId, match.loserSlot, loserOf(match));
  }
}

function fill(
  matches: BracketMatch[],
  matchId: string,
  slot: "A" | "B",
  teamId: string | null
) {
  const match = findMatch(matches, matchId);
  if (!match || match.status === "completed" || match.status === "ready") return;
  if (slot === "A") {
    if (match.teamASet) return;
    match.teamAId = teamId;
    match.teamASet = true;
  } else {
    if (match.teamBSet) return;
    match.teamBId = teamId;
    match.teamBSet = true;
  }
  resolve(matches, match);
}

function resolve(matches: BracketMatch[], match: BracketMatch) {
  if (match.status === "completed" || match.status === "ready") return;
  if (!match.teamASet || !match.teamBSet) {
    match.status = "pending";
    return;
  }
  if (match.teamAId && match.teamBId) {
    match.status = "ready";
    return;
  }
  match.winnerId = match.teamAId || match.teamBId;
  match.status = "completed";
  advance(matches, match);
}

function buildSkeleton(size: FieldSize, kind: BracketKind): BracketMatch[] {
  const matches: BracketMatch[] = [];
  const wbRounds = Math.log2(size);
  for (let round = 0; round < wbRounds; round++) {
    const count = size / 2 / 2 ** round;
    for (let position = 0; position < count; position++) {
      const match = blank("winners", round, position);
      if (round < wbRounds - 1) {
        match.nextMatchId = matchKey("winners", round + 1, Math.floor(position / 2));
        match.nextSlot = position % 2 === 0 ? "A" : "B";
      }
      matches.push(match);
    }
  }
  if (kind === "single") return matches;

  const lbRounds = 2 * (wbRounds - 1);
  let count = size / 4;
  for (let round = 0; round < lbRounds; round++) {
    if (round > 0 && round % 2 === 0) count = count / 2;
    for (let position = 0; position < count; position++) {
      matches.push(blank("losers", round, position));
    }
  }
  for (let round = 0; round < lbRounds - 1; round++) {
    const curr = matches.filter((m) => m.side === "losers" && m.round === round);
    const next = matches.filter((m) => m.side === "losers" && m.round === round + 1);
    for (const match of curr) {
      if (next.length === curr.length) {
        match.nextMatchId = matchKey("losers", round + 1, match.position);
        match.nextSlot = "A";
      } else {
        match.nextMatchId = matchKey("losers", round + 1, Math.floor(match.position / 2));
        match.nextSlot = match.position % 2 === 0 ? "A" : "B";
      }
    }
  }
  for (const match of matches.filter((m) => m.side === "winners")) {
    if (match.round === 0) {
      match.loserMatchId = matchKey("losers", 0, Math.floor(match.position / 2));
      match.loserSlot = match.position % 2 === 0 ? "A" : "B";
    } else {
      match.loserMatchId = matchKey("losers", 2 * match.round - 1, match.position);
      match.loserSlot = "B";
    }
  }
  matches.push(blank("grand", 0, 0), blank("grand", 1, 0));
  const wbFinal = matches.find((m) => m.side === "winners" && m.round === wbRounds - 1);
  const lbFinal = matches.find((m) => m.side === "losers" && m.round === lbRounds - 1);
  if (wbFinal) {
    wbFinal.nextMatchId = matchKey("grand", 0, 0);
    wbFinal.nextSlot = "A";
  }
  if (lbFinal) {
    lbFinal.nextMatchId = matchKey("grand", 0, 0);
    lbFinal.nextSlot = "B";
  }
  return matches;
}

/** Seed best-first team ids into an 8 or 16 slot bracket and auto-advance byes. */
export function createBracket(
  teamIdsBestFirst: string[],
  size: FieldSize,
  kind: BracketKind
): BracketMatch[] {
  const slots = seedOrder(size);
  const matches = buildSkeleton(size, kind);
  const first = matches.filter((m) => m.side === "winners" && m.round === 0);
  for (const match of first) {
    const seedA = slots[match.position * 2];
    const seedB = slots[match.position * 2 + 1];
    match.teamAId = teamIdsBestFirst[seedA - 1] ?? null;
    match.teamBId = teamIdsBestFirst[seedB - 1] ?? null;
    match.teamASet = true;
    match.teamBSet = true;
    resolve(matches, match);
  }
  return matches;
}

export function seriesWins(scores: MapScore[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const score of scores) {
    if (score.scoreA > score.scoreB) a += 1;
    else if (score.scoreB > score.scoreA) b += 1;
  }
  return { a, b };
}

/** Record a played series. Winner must be one of the two teams. */
export function applyResult(
  matches: BracketMatch[],
  matchId: string,
  winnerId: string,
  scores: MapScore[]
) {
  const match = findMatch(matches, matchId);
  if (!match) throw new Error("Match not found.");
  if (match.status !== "ready") throw new Error("That match is not ready to be reported.");
  if (winnerId !== match.teamAId && winnerId !== match.teamBId) {
    throw new Error("Winner must be one of the two teams.");
  }
  match.scores = scores;
  match.winnerId = winnerId;
  match.status = "completed";
  advance(matches, match);
  if (match.side === "grand" && match.round === 0 && winnerId === match.teamBId) {
    const reset = findMatch(matches, matchKey("grand", 1, 0));
    if (reset && reset.status === "pending") {
      reset.teamAId = match.teamAId;
      reset.teamBId = match.teamBId;
      reset.teamASet = true;
      reset.teamBSet = true;
      reset.status = "ready";
    }
  }
}

export function bracketFinished(matches: BracketMatch[], kind: BracketKind): boolean {
  if (kind === "single") {
    const final = matches.find((m) => m.side === "winners" && !m.nextMatchId);
    return !!final && final.status === "completed" && !!final.winnerId;
  }
  const grand = findMatch(matches, matchKey("grand", 0, 0));
  const reset = findMatch(matches, matchKey("grand", 1, 0));
  if (!grand || grand.status !== "completed" || !grand.winnerId) return false;
  if (grand.winnerId === grand.teamAId) return true;
  return !!reset && reset.status === "completed" && !!reset.winnerId;
}

export function placements(
  matches: BracketMatch[],
  kind: BracketKind
): { first: string; second: string | null; thirds: string[] } {
  if (kind === "single") {
    const finals = matches.filter((m) => m.side === "winners");
    const lastRound = Math.max(...finals.map((m) => m.round));
    const final = finals.find((m) => m.round === lastRound);
    if (!final?.winnerId) throw new Error("Bracket is not finished.");
    const second = final.winnerId === final.teamAId ? final.teamBId : final.teamAId;
    const thirds = finals
      .filter((m) => m.round === lastRound - 1)
      .map(loserOf)
      .filter((id): id is string => !!id);
    return { first: final.winnerId, second, thirds };
  }
  const reset = findMatch(matches, matchKey("grand", 1, 0));
  const grand = findMatch(matches, matchKey("grand", 0, 0));
  const decider = reset?.status === "completed" && reset.winnerId ? reset : grand;
  if (!decider?.winnerId) throw new Error("Bracket is not finished.");
  const second = decider.winnerId === decider.teamAId ? decider.teamBId : decider.teamAId;
  const losers = matches.filter((m) => m.side === "losers");
  const lbFinal = losers.find((m) => m.round === Math.max(...losers.map((row) => row.round)));
  const third = lbFinal ? loserOf(lbFinal) : null;
  return { first: decider.winnerId, second, thirds: third ? [third] : [] };
}

export function roundLabel(match: BracketMatch, size: number): string {
  if (match.side === "grand") return match.round === 0 ? "Grand Final" : "Grand Final Reset";
  if (match.side === "losers") return `Losers Round ${match.round + 1}`;
  const wbRounds = Math.log2(size);
  const fromEnd = wbRounds - 1 - match.round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round of ${size / 2 ** match.round}`;
}

function teamLabel(
  id: string | null,
  set: boolean,
  names: Map<string, string>
): string | null {
  if (!set) return null;
  if (!id) return "BYE";
  return names.get(id) || "Team";
}

export function matchesToView(
  matches: BracketMatch[],
  names: Map<string, string>,
  side: MatchSide,
  size: number,
  tournamentId: string
): Bracket | null {
  const rows = matches.filter((m) => {
    if (m.side !== side) return false;
    if (side === "grand" && m.round === 1 && m.status === "pending") return false;
    return true;
  });
  if (!rows.length) return null;
  const rounds = [...new Set(rows.map((m) => m.round))].sort((a, b) => a - b);
  return {
    tournamentId,
    type: side === "winners" && !matches.some((m) => m.side === "losers") ? "single" : "double",
    rounds: rounds.map((round) => {
      const inRound = rows.filter((m) => m.round === round).sort((a, b) => a.position - b.position);
      const sample = inRound[0];
      return {
        name: sample ? roundLabel(sample, size) : `Round ${round + 1}`,
        matches: inRound.map((m) => toViewMatch(m, names)),
      };
    }),
  };
}

function toViewMatch(match: BracketMatch, names: Map<string, string>): ViewMatch {
  const wins = seriesWins(match.scores);
  const played = match.scores.length > 0;
  const teamA = teamLabel(match.teamAId, match.teamASet, names);
  const teamB = teamLabel(match.teamBId, match.teamBSet, names);
  return {
    id: match.id,
    round: match.round,
    position: match.position,
    teamA,
    teamB,
    scoreA: played ? wins.a : null,
    scoreB: played ? wins.b : null,
    winner: match.winnerId ? names.get(match.winnerId) || "Team" : null,
    status: match.status === "ready" ? "live" : match.status === "completed" ? "completed" : "upcoming",
    map: match.scores.map((s) => s.map).join(", ") || undefined,
  };
}
