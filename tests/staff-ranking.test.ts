/**
 * The staff panel's Ranking tab data (CBL bot docs/STAFF_PANEL_PLAN.md step 3):
 * live matches to rank into (no league rooms, no dead lobbies), the latest
 * ranked matches with who won and lost, and the Elo boost.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-ranking");
let sr: typeof import("@/lib/staff-ranking");
let client: typeof import("@/lib/db").client;

const NOW = Date.parse("2026-10-05T18:00:00Z");
const lobby = (extra: Record<string, unknown>) =>
  JSON.stringify({
    matchNumber: 12,
    selectedMap: "Dust II",
    region: "EU",
    queueMode: "standard",
    createdAt: NOW - 20 * 60_000,
    members: [
      { discordId: "1", name: "alice", team: 1 },
      { discordId: "2", name: "bob", team: 2 },
    ],
    ...extra,
  });

before(async () => {
  sr = await import("@/lib/staff-ranking");
  client = (await import("@/lib/db")).client;
  await client.batch(
    [
      "CREATE TABLE web_lobbies (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)",
      `CREATE TABLE match_history (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER, player_name TEXT,
         result TEXT, timestamp TEXT, map_name TEXT, round_score TEXT, mode TEXT, executed_by TEXT,
         cbrm_game_id TEXT, is_test INTEGER DEFAULT 0)`,
      "CREATE TABLE bot_state (key TEXT PRIMARY KEY, value TEXT)",
      "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT UNIQUE, discord_id INTEGER)",
      "INSERT INTO players (name, discord_id) VALUES ('Alice_Real', 1)",
      {
        sql: "INSERT INTO web_lobbies VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
        args: [
          "300000000000000555", lobby({}), NOW - 20 * 60_000,
          "300000000000000556", lobby({ queueMode: "league", matchNumber: 13 }), NOW - 10 * 60_000,
          "300000000000000557", lobby({ matchNumber: 2 }), NOW - 5 * 60 * 60_000,
        ],
      },
      `INSERT INTO match_history (match_id, player_name, result, timestamp, map_name, round_score, mode, executed_by, cbrm_game_id)
       VALUES (7, 'alice', 'W', '2026-10-05 17:00:00', 'Dust II', '16,13', '5v5', 'staffer', '1Woq74ZG'),
              (7, 'bob', 'L', '2026-10-05 17:00:00', 'Dust II', '16,13', '5v5', 'staffer', '1Woq74ZG'),
              (8, 'carol', 'D', '2026-10-05 17:30:00', 'Mirage', '15,15', '5v5', 'staffer', NULL),
              (8, 'dave', 'D', '2026-10-05 17:30:00', 'Mirage', '15,15', '5v5', 'staffer', NULL)`,
      "INSERT INTO bot_state VALUES ('elo_gain_multiplier', '2')",
    ],
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["web_lobbies", "match_history", "bot_state", "players"]);
});

describe("staff ranking view", () => {
  it("lists live matches to rank into, not league rooms or dead lobbies", async () => {
    const view = await sr.staffRankingView(NOW);
    assert.deepEqual(view.liveMatches.map((m) => m.id), ["300000000000000555"]);
    const [m] = view.liveMatches;
    assert.equal(m.matchNumber, 12);
    assert.equal(m.map, "Dust II");
    assert.deepEqual(m.teams, { team1: ["Alice_Real"], team2: ["bob"] }, "player names by Discord id, else the lobby's name");
  });

  it("shows the latest ranked matches, newest first, with winners and losers", async () => {
    const view = await sr.staffRankingView(NOW);
    assert.deepEqual(view.recent.map((r) => r.matchId), [8, 7]);
    const [draw, win] = view.recent;
    assert.deepEqual([win.winners, win.losers, win.others], [["alice"], ["bob"], []]);
    assert.equal(win.cbrmGameId, "1Woq74ZG");
    assert.equal(win.score, "16,13");
    assert.deepEqual(draw.others, ["carol", "dave"], "a draw's players go under others");
    assert.equal(view.boost, 2);
  });

  it("reads a broken lobby or a missing boost as nothing", async () => {
    assert.equal(sr.liveMatchOption("x", "{not json", NOW), null);
    await client.execute("DELETE FROM bot_state");
    assert.equal((await sr.staffRankingView(NOW)).boost, 1);
  });
});
