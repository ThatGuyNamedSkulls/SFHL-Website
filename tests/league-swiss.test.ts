/**
 * League v2 (docs/LEAGUE_V2_PLAN.md, Part B), website side: Swiss week 1,
 * Swiss standings with byes and season moves match the bot
 * (tests/league-vectors.json); a big division is drawn and started as Swiss.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("league-swiss");
let swiss: typeof import("@/lib/league-swiss");
let admin: typeof import("@/lib/league-admin");
let league: typeof import("@/lib/league");
let client: typeof import("@/lib/db").client;

const TABLES = [
  "league_byes", "league_team_access", "league_events", "league_matches", "league_entries", "league_divisions",
  "league_seasons", "web_teams", "players",
];
const STAFF = { discordId: "900", name: "Mod" };
const vectors = JSON.parse(readFileSync(join(__dirname, "league-vectors.json"), "utf-8"));

before(async () => {
  swiss = await import("@/lib/league-swiss");
  admin = await import("@/lib/league-admin");
  league = await import("@/lib/league");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await client.execute(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER, country TEXT)"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

describe("Swiss and moves rules match the bot", () => {
  it("week 1 from the seeds", () => {
    for (const c of vectors.swissFirstRound) {
      const [pairs, bye] = swiss.firstRound(c.teams);
      assert.deepEqual([pairs, bye], [c.pairs, c.bye], `${c.teams.length} teams`);
    }
  });

  it("Swiss standings with byes and Buchholz", () => {
    for (const c of vectors.swissStandings) {
      assert.deepEqual(swiss.swissStandings(c.teams, c.matches, c.byes), c.expected);
    }
  });

  it("how many move, and where", () => {
    for (const [n, k] of Object.entries(vectors.movesCount)) assert.equal(swiss.movesCount(Number(n)), k, `${n} teams`);
    for (const c of vectors.seasonMoves) assert.deepEqual(swiss.seasonMoves(c.places, c.codes), c.expected, c.label);
    assert.equal(swiss.formatFor(7), "rr");
    assert.equal(swiss.formatFor(8), "swiss");
  });
});

describe("a Swiss division on the website", () => {
  it("9 teams in one band are drawn as Swiss and started with week 1 + a bye", async () => {
    for (let t = 0; t < 9; t++) {
      const ids = [String(3000 + t * 10), String(3001 + t * 10)];
      const team = {
        id: `w${t}`, name: `W ${t}`, tag: `W${t}`, logoUrl: null, accentColor: "#ff5500", region: "EU",
        captainId: ids[0], captainName: `p${ids[0]}`,
        members: ids.map((d) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
          role: "starter", status: "accepted", joinedAt: 0 })),
        createdAt: 0, updatedAt: 0,
      };
      await client.execute({ sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [team.id, JSON.stringify(team), t] });
      for (const d of ids) {
        await client.execute({ sql: "INSERT INTO players (name, elo, placement_done) VALUES (?, ?, 1)", args: [`p${d}`, 1800 - t * 20] });
      }
    }
    const s = await admin.createSeason("Swiss", STAFF);
    await admin.openSignups(s.id, 7, STAFF);
    for (let t = 0; t < 9; t++) await league.signUpTeam(`w${t}`, String(3000 + t * 10));
    const drawn = await admin.closeSignups(s.id, STAFF);
    assert.deepEqual(drawn.divisions.map((d) => [d.name, d.format, d.teams.length]), [["Open 5-7", "swiss", 9]]);

    const plan = await admin.startSeason(s.id, "2099-01-05", STAFF, Date.UTC(2098, 0, 1));
    assert.deepEqual(plan.divisions.map((d) => [d.format, d.matches]), [["swiss", 4]]);
    const matches = await league.seasonMatches(s.id);
    assert.deepEqual(matches.map((m) => [m.week, m.teamA, m.teamB]), [[1, "w0", "w4"], [1, "w1", "w5"], [1, "w2", "w6"], [1, "w3", "w7"]]);
    const byes = await league.seasonByes(s.id);
    assert.deepEqual(byes.map((b) => [b.week, b.teamId]), [[1, "w8"]]);

    // The page: the bye counts as a win in the Swiss table and shows in week 1.
    const view = await league.leagueView(s.id, null);
    const [div] = view.divisions;
    assert.equal(div.format, "swiss");
    assert.deepEqual(div.byes.map((b) => [b.week, b.team.id]), [[1, "w8"]]);
    assert.equal(div.standings[0].teamId, "w8");
    assert.deepEqual([div.standings[0].points, div.standings[0].played], [3, 1]);
  });
});
