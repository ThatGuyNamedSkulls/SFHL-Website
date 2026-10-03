import { NextResponse } from "next/server";
import {
  getCbStats,
  getLongestWinStreak,
  getMapTotals,
  getPlayer,
  getSeasonResets,
  getStatTotals,
  type StatTotals,
} from "@/lib/db";
import { damagePerRound, kdRatio } from "@/lib/match-stats";
import { prettyMap } from "@/lib/format";

/** The numbers the Stats tab shows for one set of matches. */
function shape(t: StatTotals) {
  const per = (v: number) => (t.matches > 0 ? v / t.matches : 0);
  return {
    matches: t.matches,
    wins: t.wins,
    losses: t.matches - t.wins,
    winPercent: t.matches > 0 ? (t.wins / t.matches) * 100 : 0,
    kills: per(t.kills),
    deaths: per(t.deaths),
    assists: per(t.assists),
    kd: kdRatio(t.kills, t.deaths),
    /** Kills per round, only over matches whose round count is known. */
    kr: t.rounds > 0 ? t.roundKills / t.rounds : null,
    hsPercent: t.hsPercent,
    adr: t.damageRounds > 0 ? Math.round((t.damage / t.damageRounds) * 10) / 10 : null,
    mvpsPerMatch: per(t.mvps),
    /** Average |Elo change| per match ("Elo swing"; not the rating swing). */
    eloSwing: per(t.absElo),
    eloChange: t.elo,
  };
}

/**
 * GET ?scope=season|career — the profile's Stats tab, loaded when the tab
 * opens: totals, longest win streak, Counter Blox multi-kills and per-map
 * numbers, all ranked matches only (no placements, no dummy matches).
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const player = await getPlayer(decodeURIComponent(name));
    if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    const scope = new URL(request.url).searchParams.get("scope") === "career" ? "career" : "season";
    const resets = await getSeasonResets();
    const seasonStart = resets.length ? resets[resets.length - 1].reset_at : null;
    const since = scope === "season" ? seasonStart : null;

    const [totals, longestWinStreak, maps, cb] = await Promise.all([
      getStatTotals(player.name, since),
      getLongestWinStreak(player.name, since),
      getMapTotals(player.name, since),
      getCbStats(player.name, since),
    ]);

    return NextResponse.json({
      scope,
      season: { number: resets.length + 1, label: `Season ${resets.length + 1}`, startedAt: seasonStart },
      totals: shape(totals),
      longestWinStreak,
      cb: cb && {
        matches: cb.matches,
        roundsPlayed: cb.roundsPlayed,
        adr: damagePerRound(cb.damage, cb.roundsPlayed),
        firstKills: cb.firstKills,
        rounds2k: cb.rounds2k,
        rounds3k: cb.rounds3k,
        rounds4k: cb.rounds4k,
        rounds5k: cb.rounds5k,
      },
      maps: maps
        .filter((m) => m.matches > 0)
        .map((m) => ({ map: prettyMap(m.map) || "Unknown", ...shape(m) })),
    });
  } catch (error) {
    console.error("player stats GET", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
