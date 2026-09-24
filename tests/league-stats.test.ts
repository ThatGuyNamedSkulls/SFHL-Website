/**
 * League UI step 9 (docs/LEAGUE_UI_PLAN.md): league stats — scoreboard
 * validation, reading /ocr2rank output, per-player totals, and Match Staff
 * saving / replacing / deleting a map scoreboard on a real (temp) season.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("league-stats");
let rules: typeof import("@/lib/league-stats-rules");
let stats: typeof import("@/lib/league-stats");
let admin: typeof import("@/lib/league-admin");
let league: typeof import("@/lib/league");
let lm: typeof import("@/lib/league-matches");
let client: typeof import("@/lib/db").client;

const TABLES = [
  "league_match_stats", "league_team_access", "league_events", "league_matches", "league_entries",
  "league_divisions", "league_seasons", "web_teams", "players", "discord_dm_outbox",
];
const STAFF = { discordId: "900", name: "Mod" };

before(async () => {
  rules = await import("@/lib/league-stats-rules");
  stats = await import("@/lib/league-stats");
  admin = await import("@/lib/league-admin");
  league = await import("@/lib/league");
  lm = await import("@/lib/league-matches");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await (await import("@/lib/social")).ensureSocialSchema();
  await client.execute(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER, country TEXT)"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

const MATCH = {
  bo: 1, teamA: "A", teamB: "B", status: "final", scoreA: 13, scoreB: 7,
  rosterA: [{ discordId: "1", name: "alpha" }, { discordId: "2", name: "Bravo_One" }],
  rosterB: [{ discordId: "3", name: "charlie" }],
};
const line = (teamId: string, discordId: string, extra: Record<string, unknown> = {}) => ({
  teamId, discordId, kills: 10, deaths: 5, assists: 2, mvps: 1, score: 30, hs: 50, ...extra,
});
const board = (extra: Record<string, unknown> = {}) => ({
  mapNo: 1, mapName: " Dust II ", roundsA: 13, roundsB: 7,
  players: [line("A", "1"), line("A", "2"), line("B", "3")], ...extra,
});

describe("scoreboard rules", () => {
  it("validates against the match: final result, rounds, rosters, numbers", () => {
    const ok = rules.validateScoreboard(board(), MATCH);
    assert.deepEqual([ok.mapName, ok.players.map((p) => p.name)], ["Dust II", ["alpha", "Bravo_One", "charlie"]]);
    const bad = (extra: Record<string, unknown>, m = MATCH) => () => rules.validateScoreboard(board(extra), m);
    assert.throws(bad({}, { ...MATCH, status: "forfeit" }), /confirmed \(non-forfeit\) result/);
    assert.throws(bad({ roundsA: 13, roundsB: 13 }), /draw/);
    assert.throws(bad({ roundsA: 13, roundsB: 9 }), /must match the result \(13–7\)/);
    assert.throws(bad({ mapNo: 2 }), /map number/);
    assert.throws(bad({ players: [line("A", "3"), line("B", "3")] }), /league roster/);
    assert.throws(bad({ players: [line("A", "1"), line("A", "1"), line("B", "3")] }), /listed twice/);
    assert.throws(bad({ players: [line("A", "1")] }), /each team/);
    assert.throws(bad({ players: [line("A", "1", { hs: 120 }), line("B", "3")] }), /HS% must be 0–100/);
    assert.throws(bad({ players: [line("A", "1", { kills: -1 }), line("B", "3")] }), /whole number/);
    // BO3: any map 1–3, maps can go either way.
    const bo3 = { ...MATCH, bo: 3, scoreA: 2, scoreB: 1 };
    assert.equal(rules.validateScoreboard(board({ mapNo: 3, roundsA: 5, roundsB: 13 }), bo3).mapNo, 3);
  });

  it("reads /ocr2rank output and raw OCR JSON", () => {
    const cmd =
      "/rank player_names: alpha,@bravo one,Charlie match_results: W,W,L scores: 30,20,10 kills: 20,15,NONE " +
      "deaths: 10,12,18 assists: 1,2,3 mvps: 3,1,0 hs: 55.5,40,33.3 points: 13,9 map_name: de_dust2 region: EU";
    const p = rules.parseOcrPaste(cmd)!;
    assert.deepEqual([p.mapName, p.winnerRounds, p.loserRounds], ["de_dust2", 13, 9]);
    assert.deepEqual(p.players[1], { name: "bravo one", result: "W", kills: 15, deaths: 12, assists: 2, mvps: 1, score: 20, hs: 40 });
    assert.equal(p.players[2].kills, null, "NONE → empty");
    const placeholder = rules.parseOcrPaste("player_names: a,b points: <winners,losers e.g. 13,11>")!;
    assert.deepEqual([placeholder.winnerRounds, placeholder.loserRounds], [null, null]);
    const json = rules.parseOcrPaste('{"player_names":["x"],"kills":[3],"hs":["83.4%"],"map_name":"Mirage"}')!;
    assert.deepEqual([json.mapName, json.players[0].kills, json.players[0].hs], ["Mirage", 3, 83.4]);
    assert.equal(rules.parseOcrPaste("hello"), null);
    assert.equal(rules.matchRosterName("Bravo One", MATCH.rosterA)?.discordId, "2", "spaces/underscores/case ignored");
    assert.equal(rules.matchRosterName("delta", MATCH.rosterA), null);
  });

  it("adds up players: wins per match, kill-weighted HS%, K/D, K/R", () => {
    const row = (matchId: number, mapNo: number, kills: number, deaths: number, hs: number, won: number, lost: number) => ({
      matchId, mapNo, teamId: "A", discordId: "1", name: "alpha", kills, deaths, assists: 1, mvps: 1, score: 20, hs,
      roundsWon: won, roundsLost: lost,
    });
    const [t] = rules.playerTotals(
      [row(1, 1, 20, 10, 50, 13, 7), row(2, 1, 10, 10, 20, 2, 13), row(2, 2, 0, 5, 0, 13, 11)],
      new Map([[1, "A"], [2, "B"]])
    );
    assert.deepEqual(
      [t.matches, t.maps, t.wins, t.kills, t.deaths, t.rounds, t.hs, t.kd, t.kr, t.avgScore],
      [2, 3, 1, 30, 25, 59, 40, 1.2, 0.51, 20]
    );
    const [zero] = rules.playerTotals([row(1, 1, 7, 0, 0, 13, 0)], new Map());
    assert.equal(zero.kd, 7, "no deaths: K/D = kills");
    const a = { ...t, name: "a", kills: 5, kd: 1 };
    const b = { ...t, name: "b", kills: 9, kd: 1 };
    assert.deepEqual(rules.sortTotals([a, b], "kd").map((x) => x.name), ["b", "a"], "ties → more kills first");
    assert.deepEqual(rules.sortTotals([b, a], "kills", true).map((x) => x.name), ["a", "b"]);
    assert.equal(rules.parseSort("bogus"), "kills");
  });
});

describe("saving scoreboards on a season", () => {
  async function addTeam(t: number) {
    const ids = [String(1000 + t * 10), String(1001 + t * 10)];
    const team = {
      id: `team${t}`, name: `Team ${t}`, tag: `T${t}`, logoUrl: null, accentColor: "#ff5500", region: "EU",
      captainId: ids[0], captainName: `p${ids[0]}`,
      members: ids.map((d) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
        role: "starter", status: "accepted", joinedAt: 0 })),
      createdAt: 0, updatedAt: 0,
    };
    await client.execute({ sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [team.id, JSON.stringify(team), t] });
    for (const d of ids) {
      await client.execute({ sql: "INSERT INTO players (name, elo, placement_done, country) VALUES (?, 1500, 1, 'pt')", args: [`p${d}`] });
    }
  }

  it("staff save, replace and delete a map; the Stats tab adds it up", async () => {
    const s = await admin.createSeason("Season 5", STAFF);
    await admin.openSignups(s.id, 7, STAFF);
    for (let t = 0; t < 4; t++) {
      await addTeam(t);
      await league.signUpTeam(`team${t}`, String(1000 + t * 10));
    }
    await admin.closeSignups(s.id, STAFF);
    await admin.startSeason(s.id, "2099-01-05", STAFF, Date.UTC(2098, 0, 1));
    const [m, other] = await league.seasonMatches(s.id);
    const sides = (id: string) => [String(1000 + Number(id.slice(4)) * 10), String(1001 + Number(id.slice(4)) * 10)];
    const players = (killsA: number) => [
      ...sides(m.teamA).map((d) => ({ teamId: m.teamA, discordId: d, kills: killsA, deaths: 8, assists: 1, mvps: 2, score: 40, hs: 50 })),
      ...sides(m.teamB).map((d) => ({ teamId: m.teamB, discordId: d, kills: 6, deaths: 12, assists: 0, mvps: 0, score: 15, hs: 25 })),
    ];

    await assert.rejects(stats.saveMapStats(m.id, { mapNo: 1, roundsA: 13, roundsB: 7, players: players(12) }, STAFF), /confirmed/);
    await lm.staffSetResult(m.id, { winner: m.teamA, scoreA: 13, scoreB: 7 }, STAFF);
    await stats.saveMapStats(m.id, { mapNo: 1, mapName: "Mirage", roundsA: 13, roundsB: 7, players: players(12) }, STAFF);
    await stats.saveMapStats(m.id, { mapNo: 1, mapName: "Mirage", roundsA: 13, roundsB: 7, players: players(14) }, STAFF); // fix a typo
    const n = await client.execute({ sql: "SELECT COUNT(*) AS n FROM league_match_stats WHERE match_id = ?", args: [m.id] });
    assert.equal(Number(n.rows[0].n), 4, "replaced, not added");

    const [map] = await stats.matchScoreboards(m.id, m.teamA);
    assert.deepEqual([map.mapName, map.roundsA, map.roundsB, map.players.length], ["Mirage", 13, 7, 4]);
    assert.deepEqual(map.players.filter((p) => p.teamId === m.teamA).map((p) => p.kills), [14, 14]);

    const all = await stats.seasonStats(s.id, null);
    const top = all.find((r) => r.discordId === sides(m.teamA)[0])!;
    assert.deepEqual([top.matches, top.wins, top.kills, top.rounds, top.team.id, top.country], [1, 1, 14, 20, m.teamA, "pt"]);
    const loser = all.find((r) => r.discordId === sides(m.teamB)[0])!;
    assert.equal(loser.wins, 0);
    const otherDivision = (await league.seasonDivisions(s.id)).find((d) => d.id !== m.divisionId);
    if (otherDivision) assert.deepEqual(await stats.seasonStats(s.id, otherDivision.id), []);
    const chips = await stats.statsDivisions(s.id);
    assert.equal(chips.find((d) => d.id === m.divisionId)?.matches, 1);

    const kinds = (await admin.listEvents(s.id)).map((e) => e.kind);
    assert.equal(kinds.filter((k) => k === "stats_entered").length, 2);

    await stats.deleteMapStats(m.id, 1, STAFF);
    await assert.rejects(stats.deleteMapStats(m.id, 1, STAFF), /No stats saved/);
    assert.deepEqual(await stats.matchScoreboards(m.id, m.teamA), []);
    await assert.rejects(stats.saveMapStats(other.id + 999, { mapNo: 1 }, STAFF), /not found/);
  });
});
