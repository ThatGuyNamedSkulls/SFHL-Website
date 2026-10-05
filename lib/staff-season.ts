/**
 * The staff panel's Season tab (CBL bot docs/STAFF_PANEL_PLAN.md step 7): who
 * would get this season's Top 10 badge, how this season went so far, and the
 * past seasons. Ending the season goes through the bot's /season reset
 * (lib/staff-jobs.ts, MatchMaking Manager).
 */
import { client } from "@/lib/db";

export interface SeasonTopPlayer {
  name: string;
  elo: number;
  rank: string;
  matchesPlayed: number;
  matchesWon: number;
}

export interface PastSeason {
  name: string;
  /** When it was ended (ms), if the bot recorded it. */
  endedAt: number | null;
  /** Players whose stats were archived under it. */
  players: number;
}

export interface StaffSeasonView {
  /** Same order as /season reset picks its Top 10. */
  top10: SeasonTopPlayer[];
  /** Since the last season ended (or ever, before the first). */
  since: number | null;
  rankedMatches: number;
  placedPlayers: number;
  pastSeasons: PastSeason[];
}

type Row = Record<string, unknown>;

async function rows(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try {
    return (await client.execute({ sql, args })).rows as unknown as Row[];
  } catch {
    return [];
  }
}

function utcMs(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const ms = Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

export async function staffSeasonView(): Promise<StaffSeasonView> {
  const [top, resets, archived, placed] = await Promise.all([
    rows(
      `SELECT name, elo, rank, matches_played, matches_won FROM players
        ORDER BY elo DESC, matches_won DESC, matches_played ASC LIMIT 10`
    ),
    rows("SELECT season_name, MAX(reset_at) AS reset_at FROM season_resets GROUP BY season_name"),
    rows("SELECT season_name, COUNT(*) AS n FROM season_stats GROUP BY season_name"),
    rows("SELECT COUNT(*) AS n FROM players WHERE COALESCE(placement_done, 0) = 1"),
  ]);

  // Seasons ended before season_resets existed only show up in season_stats.
  const seasons = new Map<string, PastSeason>();
  for (const r of archived) {
    const name = String(r.season_name);
    seasons.set(name, { name, endedAt: null, players: Number(r.n) || 0 });
  }
  for (const r of resets) {
    const name = String(r.season_name);
    const prev = seasons.get(name);
    seasons.set(name, { name, endedAt: utcMs(r.reset_at), players: prev?.players ?? 0 });
  }
  const pastSeasons = [...seasons.values()].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const lastReset = resets.reduce<string | null>((max, r) => {
    const at = String(r.reset_at ?? "");
    return !max || at > max ? at : max;
  }, null);

  const matches = await rows(
    lastReset
      ? "SELECT COUNT(DISTINCT match_id) AS n FROM match_history WHERE match_id IS NOT NULL AND timestamp >= ?"
      : "SELECT COUNT(DISTINCT match_id) AS n FROM match_history WHERE match_id IS NOT NULL",
    lastReset ? [lastReset] : []
  );

  return {
    top10: top.map((p) => ({
      name: String(p.name),
      elo: Number(p.elo) || 0,
      rank: String(p.rank ?? ""),
      matchesPlayed: Number(p.matches_played) || 0,
      matchesWon: Number(p.matches_won) || 0,
    })),
    since: utcMs(lastReset),
    rankedMatches: Number(matches[0]?.n) || 0,
    placedPlayers: Number(placed[0]?.n) || 0,
    pastSeasons,
  };
}
