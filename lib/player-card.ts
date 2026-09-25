/**
 * Data for the FACEIT-style player card (docs/LEAGUE_V2_PLAN.md D1): used by
 * the upcoming Overview, the Find pages and the team page. Pure.
 */
import { getRankByLetter, getRankForElo } from "@/data/ranks";
import type { RankTierLetter } from "@/types";

export interface PlayerCardData {
  name: string;
  /** Team tag shown before the name ("[HL] name"). */
  tag: string | null;
  avatar: string | null;
  country: string | null;
  /** Main Elo; null while unranked (placements not done). */
  elo: number | null;
  rank: RankTierLetter;
  /** The avatar ring: the rank's colour, filled by how far the player is through that rank (0–1). */
  ringColor: string;
  progress: number;
  /** The equipped profile card (banner art). */
  cardArt: string | null;
  /** Linked to a HyperLeague player. */
  verified: boolean;
  captain: boolean;
  me: boolean;
  sub: boolean;
  coach: boolean;
}

/** The ring for an Elo: colour of its rank and progress through it (the top rank has no ceiling: full). */
export function rankRing(elo: number | null): { rank: RankTierLetter; color: string; progress: number } {
  if (elo === null || elo <= 0) {
    const t = getRankByLetter("UNRANKED");
    return { rank: t.letter, color: t.color, progress: 0 };
  }
  const t = getRankForElo(elo);
  // ★ runs to 9999: it's the top, so its ring is always full.
  const span = t.maxElo >= 9999 ? 0 : t.maxElo + 1 - t.minElo;
  const progress = span > 0 ? Math.min(1, Math.max(0, (elo - t.minElo) / span)) : 1;
  return { rank: t.letter, color: t.color, progress: Math.round(progress * 100) / 100 };
}

/** A players-table row's main Elo, or null while unranked (placements not done). */
export function eloOfRow(row: Record<string, unknown> | undefined): number | null {
  return row && Number(row.placement_done ?? 1) === 1 && Number(row.elo) > 0 ? Number(row.elo) : null;
}

/** One team member's card from their players row (may be missing) and equipped card art. */
export function cardFromMember(
  m: { discordId: string; username: string; playerName: string | null; avatar: string | null; role: string },
  opts: {
    row?: Record<string, unknown>;
    tag?: string | null;
    captainId?: string | null;
    viewerId?: string | null;
    cardArt?: string | null;
  } = {}
): PlayerCardData {
  const { row } = opts;
  const elo = eloOfRow(row);
  const ring = rankRing(elo);
  return {
    name: m.playerName || m.username,
    tag: opts.tag || null,
    avatar: (row?.roblox_avatar_image as string | null | undefined) ?? m.avatar ?? null,
    country: row?.country ? String(row.country).toLowerCase() : null,
    elo,
    rank: ring.rank,
    ringColor: ring.color,
    progress: ring.progress,
    cardArt: opts.cardArt ?? null,
    verified: !!m.playerName,
    captain: m.role === "captain" || (!!opts.captainId && m.discordId === opts.captainId),
    me: !!opts.viewerId && m.discordId === opts.viewerId,
    sub: m.role === "sub",
    coach: m.role === "coach",
  };
}
