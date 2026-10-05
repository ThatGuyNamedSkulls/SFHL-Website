/**
 * What the staff panel's Ranking tab shows (CBL bot docs/STAFF_PANEL_PLAN.md
 * step 3), read straight from the database: the live matches a CBRM game can
 * be ranked into, the latest ranked matches (to undo one), and the Elo boost.
 * Ranking itself goes through the bot (lib/staff-jobs.ts).
 */
import { client } from "@/lib/db";

/** Same window as lib/lobby.ts: a lobby row older than this is a dead match. */
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const RECENT_MATCHES = 15;

export interface LiveMatchOption {
  /** The match's Discord channel id (= web_lobbies.id). */
  id: string;
  matchNumber: number | null;
  map: string | null;
  region: string | null;
  queueMode: string | null;
  createdAt: number;
  teams: { team1: string[]; team2: string[] };
}

export interface RecentRankedMatch {
  matchId: number;
  at: string;
  map: string | null;
  score: string | null;
  mode: string | null;
  by: string | null;
  cbrmGameId: string | null;
  test: boolean;
  winners: string[];
  losers: string[];
  /** Draws and odd results: everyone else. */
  others: string[];
}

export interface StaffRankingView {
  liveMatches: LiveMatchOption[];
  recent: RecentRankedMatch[];
  /** The Elo boost multiplier: 1 = off. */
  boost: number;
}

type Row = Record<string, unknown>;

async function rows(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try {
    return (await client.execute({ sql, args })).rows as unknown as Row[];
  } catch {
    return []; // table or column not there yet
  }
}

const str = (v: unknown) => (v == null || v === "" ? null : String(v));

/**
 * One web_lobbies row as a pick-list entry; null for league rooms (no Elo) and
 * broken rows. `playerOf` maps a member's Discord id to their player name (the
 * lobby only has Discord display names, which /rank manual doesn't know).
 */
export function liveMatchOption(
  id: string,
  data: string,
  createdAt: number,
  playerOf: Map<string, string> = new Map()
): LiveMatchOption | null {
  let lobby: Record<string, unknown>;
  try {
    lobby = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const queueMode = str(lobby.queueMode);
  if (queueMode === "league") return null;
  const members = Array.isArray(lobby.members) ? (lobby.members as Record<string, unknown>[]) : [];
  const teamOf = (n: number) =>
    members
      .filter((m) => Number(m.team) === n)
      .map((m) => playerOf.get(String(m.discordId ?? "")) ?? String(m.name ?? "?"));
  const number = Number(lobby.matchNumber);
  return {
    id,
    matchNumber: Number.isInteger(number) && number > 0 ? number : null,
    map: str(lobby.selectedMap) ?? str(lobby.map),
    region: str(lobby.region),
    queueMode,
    createdAt: Number(lobby.createdAt) || createdAt,
    teams: { team1: teamOf(1), team2: teamOf(2) },
  };
}

export async function staffRankingView(now = Date.now()): Promise<StaffRankingView> {
  const [lobbies, matches, boostRow] = await Promise.all([
    rows("SELECT id, data, created_at FROM web_lobbies WHERE created_at >= ? ORDER BY created_at DESC", [
      now - LIVE_WINDOW_MS,
    ]),
    rows(
      `SELECT match_id, MIN(timestamp) AS at, MAX(map_name) AS map, MAX(round_score) AS score, MAX(mode) AS mode,
              MAX(executed_by) AS by, MAX(cbrm_game_id) AS cbrm, MAX(COALESCE(is_test, 0)) AS test
         FROM match_history WHERE match_id IS NOT NULL
        GROUP BY match_id ORDER BY match_id DESC LIMIT ?`,
      [RECENT_MATCHES]
    ),
    rows("SELECT value FROM bot_state WHERE key = 'elo_gain_multiplier'"),
  ]);

  // Lobby members' player names, by Discord id.
  const memberIds = new Set<string>();
  for (const l of lobbies) {
    try {
      const data = JSON.parse(String(l.data)) as { members?: { discordId?: unknown }[] };
      for (const m of data.members ?? []) if (m.discordId) memberIds.add(String(m.discordId));
    } catch {
      /* broken row: skipped below too */
    }
  }
  const memberRows = memberIds.size
    ? await rows(
        `SELECT CAST(discord_id AS TEXT) AS did, name FROM players WHERE discord_id IN (${[...memberIds].map(() => "?").join(", ")})`,
        [...memberIds]
      )
    : [];
  const playerOf = new Map(memberRows.map((r) => [String(r.did), String(r.name)]));

  const ids = matches.map((m) => Number(m.match_id));
  const players = ids.length
    ? await rows(
        `SELECT match_id, player_name, result FROM match_history
          WHERE match_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
        ids
      )
    : [];
  const byMatch = new Map<number, Row[]>();
  for (const p of players) {
    const id = Number(p.match_id);
    byMatch.set(id, [...(byMatch.get(id) ?? []), p]);
  }

  const boost = Number(boostRow[0]?.value);
  return {
    liveMatches: lobbies
      .map((l) => liveMatchOption(String(l.id), String(l.data), Number(l.created_at), playerOf))
      .filter((m): m is LiveMatchOption => m !== null),
    recent: matches.map((m) => {
      const list = byMatch.get(Number(m.match_id)) ?? [];
      const named = (result: string) =>
        list.filter((p) => String(p.result ?? "").toUpperCase() === result).map((p) => String(p.player_name));
      const winners = named("W");
      const losers = named("L");
      return {
        matchId: Number(m.match_id),
        at: String(m.at ?? ""),
        map: str(m.map),
        score: str(m.score),
        mode: str(m.mode),
        by: str(m.by),
        cbrmGameId: str(m.cbrm),
        test: Number(m.test) === 1,
        winners,
        losers,
        others: list.map((p) => String(p.player_name)).filter((n) => !winners.includes(n) && !losers.includes(n)),
      };
    }),
    boost: boost === 2 || boost === 3 ? boost : 1,
  };
}
