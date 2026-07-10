import { NextResponse } from "next/server";
import { client, getMatchesByMatchId, mapRank } from "@/lib/db";
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

    const rows = await getMatchesByMatchId(numericId);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    // Split into winners (Team A) and losers (Team B). Tie matches have no
    // W/L results — split those by the stored team number instead (rows from
    // before the tie overhaul have no team either; they all land in Team A).
    const winners = rows.filter((r) => r.result === "W");
    const losers = rows.filter((r) => r.result === "L");
    const isTie = winners.length === 0 && losers.length === 0;

    let teamAPlayers: typeof rows;
    let teamBPlayers: typeof rows;
    if (isTie) {
      teamAPlayers = rows.filter((r) => (r.team ?? 1) === 1);
      teamBPlayers = rows.filter((r) => r.team === 2);
    } else {
      teamAPlayers = winners.length > 0 ? winners : losers;
      teamBPlayers = winners.length > 0 ? losers : winners;
    }

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

    // One query for every player's current rank/avatar (was one per player).
    const playerInfo = new Map<string, { rank: string; avatar: string }>();
    if (rows.length > 0) {
      const placeholders = rows.map(() => "?").join(",");
      try {
        const rs = await client.execute({
          sql: `SELECT name, rank, roblox_avatar_image FROM players WHERE name IN (${placeholders})`,
          args: rows.map((r) => r.player_name),
        });
        for (const r of rs.rows as unknown as Record<string, unknown>[]) {
          playerInfo.set(r.name as string, {
            rank: mapRank((r.rank as string) || ""),
            avatar: avatarUrl(r.roblox_avatar_image as string | null),
          });
        }
      } catch {
        /* players table unreadable — fall back to bare names below */
      }
    }

    // Build player stats for each team
    const buildPlayerStats = (players: typeof rows, team: "A" | "B") =>
      players.map((p) => {
        const info = playerInfo.get(p.player_name);
        return {
          playerId: p.player_name,
          username: p.player_name,
          avatarUrl: info?.avatar ?? "",
          rank: info?.rank ?? "UNRANKED",
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
      // The real gamemode when the bot recorded one ("1v1"/"2v2"/"5v5");
      // legacy rows fall back to the generic label.
      mode: firstRow.mode ? `Competitive ${firstRow.mode}` : "Competitive",
      teamAName: isTie ? "Team 1 (Tie)" : winners.length > 0 ? "Winners" : "Team 1",
      teamBName: isTie ? "Team 2 (Tie)" : winners.length > 0 ? "Defeated" : "Team 2",
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
