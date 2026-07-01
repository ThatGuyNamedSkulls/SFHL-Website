import { NextResponse } from "next/server";
import { getMatchesByMatchId, getPlayer, mapRank } from "@/lib/db";
import { avatarUrl, prettyMap, prettyRegion } from "@/lib/format";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;
    const numericId = parseInt(matchId, 10);

    if (isNaN(numericId)) {
      return NextResponse.json(
        { error: "Invalid match ID" },
        { status: 400 }
      );
    }

    const rows = getMatchesByMatchId(numericId);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    // Split into winners (Team A) and losers (Team B)
    const winners = rows.filter((r) => r.result === "W");
    const losers = rows.filter((r) => r.result === "L");

    const teamAPlayers = winners.length > 0 ? winners : losers;
    const teamBPlayers = winners.length > 0 ? losers : winners;

    // Determine the single overall match MVP: most round-MVPs, tie-broken by
    // points. Only this player gets the MVP star on the scoreboard.
    const mvpRow = rows.reduce<(typeof rows)[number] | null>((best, r) => {
      if (!best) return r;
      const rm = r.mvps || 0;
      const bm = best.mvps || 0;
      if (rm > bm) return r;
      if (rm === bm && (r.points || 0) > (best.points || 0)) return r;
      return best;
    }, null);
    const mvpName =
      mvpRow && (mvpRow.mvps || 0) > 0 ? mvpRow.player_name : null;

    // Build player stats for each team
    const buildPlayerStats = (
      players: typeof rows,
      team: "A" | "B"
    ) =>
      players.map((p) => {
        // Look up the player's current rank from the players table
        const playerData = getPlayer(p.player_name);
        const rank = playerData ? mapRank(playerData.rank) : "UNRANKED";

        return {
          playerId: p.player_name,
          username: p.player_name,
          avatarUrl: playerData ? avatarUrl(playerData.roblox_avatar_image) : "",
          rank,
          team,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          kdr: p.deaths > 0 ? +(p.kills / p.deaths).toFixed(2) : p.kills,
          headshotPercent: p.hs_percentage,
          score: p.points,
          mvp: p.player_name === mvpName,
          eloChange: p.elo_change,
          // These fields aren't in the DB but kept for UI compatibility
          firstKills: 0,
          clutches: 0,
          plants: 0,
          defuses: 0,
        };
      });

    const firstRow = rows[0];
    const dateStr = firstRow.timestamp?.split(" ")[0] || "";

    // Preferred headline: the real team round score stored as "winners,losers"
    // (e.g. "13,11"). Team A is the winning side, so it takes the first number.
    // Legacy rows without a round score fall back to summed player points.
    const sumPoints = (players: typeof rows) =>
      players.reduce((acc, p) => acc + (p.points || 0), 0);

    let teamAScore: number;
    let teamBScore: number;
    let scoreType: "rounds" | "points";
    if (firstRow.round_score) {
      const [w, l] = firstRow.round_score
        .split(",")
        .map((x) => parseInt(x.trim(), 10));
      teamAScore = Number.isFinite(w) ? w : 0;
      teamBScore = Number.isFinite(l) ? l : 0;
      scoreType = "rounds";
    } else {
      teamAScore = sumPoints(teamAPlayers);
      teamBScore = sumPoints(teamBPlayers);
      scoreType = "points";
    }

    const detail = {
      id: matchId,
      date: dateStr,
      region: prettyRegion(firstRow.region),
      map: prettyMap(firstRow.map_name),
      mode: "Competitive",
      teamAName: winners.length > 0 ? "Winners" : "Team 1",
      teamBName: winners.length > 0 ? "Defeated" : "Team 2",
      teamAScore,
      teamBScore,
      scoreType,
      winner: "A" as const,
      teamARoundsFirstHalf: 0,
      teamBRoundsFirstHalf: 0,
      teamARoundsSecondHalf: 0,
      teamBRoundsSecondHalf: 0,
      duration: "",
      players: [
        ...buildPlayerStats(teamAPlayers, "A"),
        ...buildPlayerStats(teamBPlayers, "B"),
      ],
      rounds: [],
    };

    return NextResponse.json(detail);
  } catch (error) {
    console.error("Error fetching match detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch match detail" },
      { status: 500 }
    );
  }
}
