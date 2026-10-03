/**
 * Pure helpers for the clan pages (docs/CLANS_UI_PLAN.md): matches played
 * together (2+ members on one team), averages and the activity feed. No
 * database: tests/clan-stats.test.ts imports it directly.
 */
import { getRankForElo } from "@/data/ranks";
import { formatRoundScore, prettyMap } from "@/lib/format";
import { parseRoundScore, performanceRating } from "@/lib/match-stats";
import { parseDbTime } from "@/lib/profile-stats";

/** One member's row in match_history (ranked games only). */
export interface TogetherRow {
  matchId: number | null;
  /** Team number (1 / 2) when stored; old rows without one use the result. */
  team: number | null;
  result: "W" | "L";
  timestamp: string;
  map: string | null;
  roundScore: string | null;
  player: string;
  eloChange: number;
  /** Scoreboard line, when the database has it (for the rating and the Elo column). */
  kills?: number;
  deaths?: number;
  assists?: number;
  mvps?: number;
  points?: number;
  roundsPlayed?: number | null;
  eloBefore?: number | null;
}

/** A member's line in a match together: the best one by rating. */
export interface TogetherBest {
  name: string;
  rating: number;
  kills: number;
  deaths: number;
  assists: number;
}

/** A ranked match where 2+ members played on the same team. */
export interface TogetherMatch {
  matchId: number;
  result: "W" | "L";
  /** UTC "YYYY-MM-DD HH:MM:SS". */
  timestamp: string;
  map: string;
  /** "13:9" from that team's side, or "". */
  score: string;
  /** Members on the team, in row order. */
  players: string[];
  /** Average Elo change of those members. */
  eloChange: number;
  /** Their average Elo after the match (members with a known Elo), or null. */
  elo: number | null;
  /** The rank that average falls in ("UNRANKED" without one). */
  rank: string;
  /** Their average scoreboard rating, or null without scoreboard lines. */
  rating: number | null;
  /** The member with the best rating, or null without scoreboard lines. */
  best: TogetherBest | null;
}

const hasLine = (r: TogetherRow) => r.kills != null && r.deaths != null;

function ratingOf(r: TogetherRow): number {
  const rounds = r.roundsPlayed && r.roundsPlayed > 0 ? r.roundsPlayed : parseRoundScore(r.roundScore)?.total ?? null;
  return performanceRating({ kills: r.kills ?? 0, deaths: r.deaths ?? 0, assists: r.assists ?? 0, rounds, score: r.points, mvps: r.mvps });
}

/** Average Elo after the match, average rating and the best member of one side's lines. */
function sideStats(list: TogetherRow[]): Pick<TogetherMatch, "elo" | "rank" | "rating" | "best"> {
  const known = list.filter((r) => r.eloBefore != null && r.eloBefore > 0);
  const elo = known.length ? Math.round(known.reduce((s, r) => s + (r.eloBefore ?? 0) + r.eloChange, 0) / known.length) : null;
  const lines = list.filter(hasLine);
  let best: TogetherBest | null = null;
  let total = 0;
  for (const r of lines) {
    const rating = ratingOf(r);
    total += rating;
    if (!best || rating > best.rating || (rating === best.rating && (r.kills ?? 0) > best.kills)) {
      best = { name: r.player, rating, kills: r.kills ?? 0, deaths: r.deaths ?? 0, assists: r.assists ?? 0 };
    }
  }
  return {
    elo,
    rank: elo ? getRankForElo(elo).letter : "UNRANKED",
    rating: lines.length ? Math.round((total / lines.length) * 100) / 100 : null,
    best,
  };
}

/**
 * Matches played together: rows of the same match and the same side, with at
 * least two different members. Same rule as the profile's "played with": the
 * team when stored, else the same result (old rows). Newest first.
 */
export function groupTogether(rows: TogetherRow[]): TogetherMatch[] {
  const groups = new Map<string, TogetherRow[]>();
  for (const r of rows) {
    if (r.matchId == null) continue;
    const side = r.team != null ? `t${r.team}` : `r${r.result}`;
    const key = `${r.matchId}:${side}`;
    const list = groups.get(key) ?? [];
    if (!list.some((x) => x.player.toLowerCase() === r.player.toLowerCase())) list.push(r);
    groups.set(key, list);
  }
  const out: TogetherMatch[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    out.push({
      matchId: first.matchId as number,
      result: first.result,
      timestamp: first.timestamp,
      map: prettyMap(first.map),
      score: formatRoundScore(first.roundScore, first.result),
      players: list.map((r) => r.player).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
      eloChange: Math.round(list.reduce((s, r) => s + r.eloChange, 0) / list.length),
      ...sideStats(list),
    });
  }
  return out.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : b.matchId - a.matchId));
}

/** How many of the matches each member played in (keys lowercased). */
export function togetherCounts(matches: TogetherMatch[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) for (const p of m.players) out.set(p.toLowerCase(), (out.get(p.toLowerCase()) ?? 0) + 1);
  return out;
}

/** Average Elo of the placed members and the rank it falls in. */
export function averageElo(players: { elo: number; placementDone: boolean }[]): {
  avg: number;
  ranked: number;
  rank: string;
} {
  const ranked = players.filter((p) => p.placementDone && p.elo > 0);
  const avg = ranked.length ? Math.round(ranked.reduce((s, p) => s + p.elo, 0) / ranked.length) : 0;
  return { avg, ranked: ranked.length, rank: avg ? getRankForElo(avg).letter : "UNRANKED" };
}

export type ClanEvent =
  | ({ kind: "match"; at: number } & TogetherMatch)
  | { kind: "join"; at: number; name: string }
  | { kind: "created"; at: number; name: string }
  | { kind: "cup"; at: number; cupId: string; name: string; status: string; teams: number; size: number };

/** The activity feed: matches together, members joining, the clan's cups. Newest first. */
export function buildActivity(input: {
  together: TogetherMatch[];
  members: { name: string; joinedAt: number; owner: boolean }[];
  createdAt: number;
  ownerName: string;
  cups: { id: string; name: string; status: string; teams: number; size: number; createdAt: number }[];
  limit?: number;
}): ClanEvent[] {
  const events: ClanEvent[] = [];
  for (const m of input.together) {
    const at = parseDbTime(m.timestamp);
    if (at == null) continue;
    events.push({ kind: "match", at, ...m });
  }
  for (const m of input.members) {
    // The owner "joined" when the clan was made: that's the "created" event.
    if (m.owner && Math.abs(m.joinedAt - input.createdAt) < 60_000) continue;
    if (m.joinedAt > 0) events.push({ kind: "join", at: m.joinedAt, name: m.name });
  }
  if (input.createdAt > 0) events.push({ kind: "created", at: input.createdAt, name: input.ownerName });
  for (const c of input.cups) {
    events.push({ kind: "cup", at: c.createdAt, cupId: c.id, name: c.name, status: c.status, teams: c.teams, size: c.size });
  }
  return events.sort((a, b) => b.at - a.at).slice(0, input.limit ?? 20);
}
