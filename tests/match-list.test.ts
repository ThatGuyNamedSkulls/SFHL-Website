/**
 * Site-wide match rows (lib/match-list.ts): the winners' score first, the
 * lobby's average Elo over ranked players, the best player by rating, the
 * viewer's own line, newest first with paging, and no dummy matches.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("match-list");
let db: typeof import("@/lib/db");
let list: typeof import("@/lib/match-list");

async function add(match: number, ts: string, player: string, result: "W" | "L", o: { kills?: number; deaths?: number; elo?: number | null; change?: number; placement?: 1; test?: 1; score?: string } = {}) {
  await db.client.execute({
    sql: `INSERT INTO match_history (match_id, timestamp, player_name, result, map_name, region, kills, deaths, assists, mvps, points,
            round_score, elo_before, elo_change, is_placement, is_test)
          VALUES (?, ?, ?, ?, 'de_dust2', 'eu', ?, ?, 2, 1, 40, ?, ?, ?, ?, ?)`,
    args: [match, ts, player, result, o.kills ?? 10, o.deaths ?? 10, o.score ?? (result === "W" ? "13,9" : "9,13"), o.elo === undefined ? 1500 : o.elo, o.change ?? (result === "W" ? 20 : -20), o.placement ?? 0, o.test ?? 0],
  });
}

before(async () => {
  db = await import("@/lib/db");
  list = await import("@/lib/match-list");
  await db.client.execute(`CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER, timestamp TEXT, player_name TEXT, result TEXT, map_name TEXT,
    region TEXT, kills INTEGER, deaths INTEGER, assists INTEGER, mvps INTEGER, points INTEGER, round_score TEXT,
    rounds_played INTEGER, elo_before INTEGER, elo_change INTEGER, is_placement INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0)`);
  // Match 1 (oldest): ana's team won 13:9; bo topped the lobby.
  await add(1, "2026-10-01 18:00:00", "ana", "W", { kills: 15, elo: 1600 });
  await add(1, "2026-10-01 18:00:00", "bo", "L", { kills: 30, deaths: 8, elo: 1400 });
  await add(1, "2026-10-01 18:00:00", "cy", "W", { elo: 900, placement: 1 }); // placement: not in the average
  // Match 2: newest real match.
  await add(2, "2026-10-02 18:00:00", "ana", "L", { elo: 1620 });
  await add(2, "2026-10-02 18:00:00", "dee", "W", { elo: null });
  // Match 3: a dummy match, never listed.
  await add(3, "2026-10-03 18:00:00", "ana", "W", { test: 1 });
});

after(async () => {
  await tmp.cleanup(["match_history"]);
});

describe("recentMatches", () => {
  it("newest first, no dummy matches, with paging", async () => {
    const first = await list.recentMatches({ limit: 1 });
    assert.deepEqual(first.matches.map((m) => m.matchId), [2]);
    assert.equal(first.hasMore, true);
    const second = await list.recentMatches({ limit: 1, offset: 1 });
    assert.deepEqual(second.matches.map((m) => m.matchId), [1]);
    assert.equal(second.hasMore, false);
  });

  it("winners' score first, average Elo of ranked players, best player, map and region", async () => {
    const { matches } = await list.recentMatches({ limit: 10 });
    const m1 = matches.find((m) => m.matchId === 1)!;
    assert.equal(m1.score, "13:9");
    assert.equal(m1.players, 3);
    assert.equal(m1.avgElo, 1500); // (1600 + 1400) / 2, the placement player left out
    assert.equal(m1.avgRank, "A3");
    assert.equal(m1.top?.name, "bo");
    assert.equal(m1.map, "Dust II");
    assert.equal(m1.region, "EU");
    assert.equal(m1.mine, null);
  });

  it("the viewer's own line: result, their side's score first, Elo change", async () => {
    const { matches } = await list.recentMatches({ limit: 10, viewer: "ANA" });
    const m2 = matches.find((m) => m.matchId === 2)!;
    assert.equal(m2.mine?.result, "L");
    assert.equal(m2.mine?.score, "9:13");
    assert.equal(m2.mine?.eloChange, -20);
    assert.equal(matches.find((m) => m.matchId === 1)!.mine?.score, "13:9");
  });
});

describe("summarizeMatch", () => {
  it("handles a match with no score or Elo", () => {
    const s = list.summarizeMatch({ matchId: 9, date: "", map: null, region: null }, []);
    assert.equal(s.score, "");
    assert.equal(s.avgElo, null);
    assert.equal(s.avgRank, "UNRANKED");
    assert.equal(s.top, null);
    assert.equal(s.players, 0);
  });
});
