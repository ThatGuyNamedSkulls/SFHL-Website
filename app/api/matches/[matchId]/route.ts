import { NextResponse } from "next/server";
import { client, getMatchesByMatchId, mapRank, ensurePlayerDiscordColumns } from "@/lib/db";
import { prettyMap, prettyRegion } from "@/lib/format";
import { resolveAvatarMap } from "@/lib/avatar";
import { isValidCountry, countryName, flagPath } from "@/lib/countries";
import {
  performanceRating,
  killsPerRound,
  swingPercent,
  kdRatio,
  roundCount,
  teamHandle,
} from "@/lib/match-stats";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";

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

    // One query for every player's current rank/avatar/elo/country.
    const playerInfo = new Map<
      string,
      { rank: string; avatar: string; elo: number; country: string | null; countryFlag: string | null }
    >();
    if (rows.length > 0) {
      const placeholders = rows.map(() => "?").join(",");
      try {
        await ensurePlayerDiscordColumns();
        const rs = await client.execute({
          sql: `SELECT name, rank, elo, country, roblox_avatar_image, discord_avatar,
                       CAST(discord_id AS TEXT) AS discord_id
                FROM players WHERE name IN (${placeholders})`,
          args: rows.map((r) => r.player_name),
        });
        const playerRows = rs.rows as unknown as {
          name: string;
          rank: string;
          elo: number;
          country: string | null;
          roblox_avatar_image: string | null;
          discord_avatar: string | null;
          discord_id: string | null;
        }[];
        const avatars = await resolveAvatarMap(playerRows);
        for (const r of playerRows) {
          const cc = isValidCountry(r.country) ? r.country!.toLowerCase() : null;
          playerInfo.set(r.name, {
            rank: mapRank(r.rank || ""),
            avatar: avatars.get(r.name) ?? "",
            elo: Number(r.elo ?? 0),
            country: cc ? countryName(cc) : null,
            countryFlag: cc ? flagPath(cc) : null,
          });
        }
        const missing = rows
          .map((r) => r.player_name)
          .filter((n) => !playerInfo.has(n));
        if (missing.length > 0) {
          const extra = await resolveAvatarMap(missing.map((name) => ({ name })));
          for (const n of missing) {
            playerInfo.set(n, {
              rank: "UNRANKED",
              avatar: extra.get(n) ?? "",
              elo: 0,
              country: null,
              countryFlag: null,
            });
          }
        }
      } catch {
        /* players table unreadable — fall back to bare names below */
      }
    }

    const firstRow = rows[0];
    const rounds = roundCount(firstRow?.round_score);

    const buildPlayerStats = (players: typeof rows, team: "A" | "B") =>
      players.map((p) => {
        const info = playerInfo.get(p.player_name);
        const rating = performanceRating({
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          rounds,
          score: p.points,
          mvps: p.mvps || 0,
        });
        return {
          playerId: p.player_name,
          username: p.player_name,
          avatarUrl: info?.avatar ?? "",
          rank: p.player_rank ? mapRank(p.player_rank) : info?.rank ?? "UNRANKED",
          elo: p.elo_before != null ? Number(p.elo_before) : undefined,
          country: info?.country ?? null,
          countryFlag: info?.countryFlag ?? null,
          team,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          kdr: kdRatio(p.kills, p.deaths),
          headshotPercent: p.hs_percentage,
          score: p.points,
          mvp: p.player_name === mvpName,
          mvps: p.mvps || 0,
          eloChange: p.elo_change,
          rating,
          swing: swingPercent(rating),
          kpr: killsPerRound(p.kills, rounds),
          firstKills: 0,
          clutches: 0,
          plants: 0,
          defuses: 0,
          isSub: Number(p.is_sub) === 1,
          leftEarly: Number(p.left_early) === 1,
          subShare: p.sub_share == null ? null : Number(p.sub_share),
        };
      });

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

    const capA = teamAPlayers[0]?.player_name || "team";
    const capB = teamBPlayers[0]?.player_name || "team";
    const detail = {
      id: matchId,
      date: dateStr,
      timestamp: firstRow.timestamp || "",
      region: prettyRegion(firstRow.region),
      map: prettyMap(firstRow.map_name),
      mode: firstRow.mode ? `Competitive ${firstRow.mode}` : "Competitive",
      modeLabel: firstRow.mode || MATCH_MODE_LABEL,
      teamAName: teamHandle(capA),
      teamBName: teamHandle(capB),
      teamAAvatar: playerInfo.get(capA)?.avatar ?? "",
      teamBAvatar: playerInfo.get(capB)?.avatar ?? "",
      teamAScore,
      teamBScore,
      scoreType,
      winner: (isTie ? "A" : winners.length > 0 ? "A" : "B") as "A" | "B",
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
