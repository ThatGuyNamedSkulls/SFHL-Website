/**
 * Team League on the website: captain sign-ups (roster rules, one team per
 * player), seed Elo, and standings with tiebreakers and forfeits.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

// ROSTER_MIN is 1 while the league is tested live; check the real rule (5).
process.env.HL_LEAGUE_ROSTER_MIN = "5";
const tmp = createTempDb("league");
let league: typeof import("@/lib/league");
let teams: typeof import("@/lib/teams");
let client: typeof import("@/lib/db").client;

const TABLES = ["league_matches", "league_entries", "league_divisions", "league_seasons", "web_teams", "players"];

function member(i: number, linked = true, status: "accepted" | "invited" = "accepted") {
  return {
    discordId: String(i),
    username: `user${i}`,
    playerName: linked ? `player${i}` : null,
    avatar: null,
    role: i % 10 === 0 ? ("captain" as const) : ("starter" as const),
    status,
    joinedAt: 0,
  };
}

async function addTeam(id: string, ids: number[], extra: ReturnType<typeof member>[] = []) {
  const team = {
    id,
    name: `Team ${id}`,
    tag: id.slice(0, 3).toUpperCase(),
    logoUrl: null,
    accentColor: "#ff5500",
    region: "EU",
    captainId: String(ids[0]),
    captainName: `player${ids[0]}`,
    members: [...ids.map((i) => member(i)), ...extra],
    createdAt: 0,
    updatedAt: 0,
  };
  await client.execute({
    sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)",
    args: [id, JSON.stringify(team), Date.now()],
  });
}

async function openSeason(status = "signup") {
  await client.execute({
    sql: "INSERT INTO league_seasons (name, status, weeks, created_at, updated_at) VALUES ('Season 1', ?, 6, 0, 0)",
    args: [status],
  });
}

before(async () => {
  league = await import("@/lib/league");
  teams = await import("@/lib/teams");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await teams.listTeams(); // creates web_teams
  await client.execute(
    "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER)"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

async function reset() {
  for (const t of TABLES) if (t !== "players") await client.execute(`DELETE FROM ${t}`);
  await client.execute("DELETE FROM players");
}

describe("league sign-ups", () => {
  it("are refused while sign-ups are closed", async () => {
    await reset();
    await addTeam("aaa", [10, 11, 12, 13, 14]);
    await assert.rejects(league.signUpTeam("aaa", "10"), /aren't open/);
    await openSeason("draft");
    await assert.rejects(league.signUpTeam("aaa", "10"), /aren't open/);
  });

  it("enforce captain, roster size, linked players and one team per player", async () => {
    await reset();
    await openSeason();
    await addTeam("aaa", [10, 11, 12, 13, 14]);
    await addTeam("short", [20, 21, 22, 23], [member(24, true, "invited")]);
    await addTeam("unlinked", [30, 31, 32, 33], [member(34, false)]);
    await addTeam("poach", [40, 41, 42, 43, 11]);

    await assert.rejects(league.signUpTeam("aaa", "11"), /Only the team captain/);
    await assert.rejects(league.signUpTeam("short", "20"), /at least 5 accepted members \(has 4\)/);
    await assert.rejects(league.signUpTeam("unlinked", "30"), /Not linked to a player: user34/);

    const entry = await league.signUpTeam("aaa", "10");
    assert.equal(entry.status, "signed_up");
    assert.equal(entry.roster.length, 5);
    await assert.rejects(league.signUpTeam("aaa", "10"), /already signed up/);
    await assert.rejects(league.signUpTeam("poach", "40"), /player11 \(Team aaa\)/);

    // The page tells the poaching captain why before they click.
    const view = await league.leagueView(null, "40");
    const option = view.viewer!.captainTeams.find((t) => t.id === "poach")!;
    assert.equal(option.signedUp, false);
    assert.match(option.problems.join(" "), /Already on another team/);
    assert.equal(view.entries.length, 1);

    await assert.rejects(league.withdrawTeam("aaa", "11"), /Only the team captain/);
    await league.withdrawTeam("aaa", "10");
    assert.equal((await league.leagueView(null, "10")).entries.length, 0);
  });

  it("seed Elo is the top-5 average with unranked players at 1200", async () => {
    await reset();
    await client.execute(
      "INSERT INTO players (name, elo, placement_done) VALUES ('player1', 2000, 1), ('player2', 2000, 1), " +
        "('player3', 2000, 1), ('player4', 2000, 1), ('player5', 2000, 1), ('player6', 2600, 0)"
    );
    const roster = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
      discordId: String(i),
      playerName: `player${i}`,
      username: "",
      role: "starter",
    }));
    assert.equal(await league.seedElo(roster), 2000);
    assert.equal(await league.seedElo(roster.slice(5)), 1200);
  });
});

describe("league standings", () => {
  const m = (
    id: number,
    a: string,
    b: string,
    status: "final" | "forfeit" | "scheduled",
    winner: string | null,
    sa: number | null = null,
    sb: number | null = null
  ) => ({
    id,
    divisionId: 1,
    week: 1,
    stage: "regular",
    teamA: a,
    teamB: b,
    bo: 1,
    status,
    scheduledAt: null,
    scoreA: sa,
    scoreB: sb,
    winner,
  });

  it("scores 3 per win, ignores unconfirmed games and orders by points", () => {
    const rows = league.computeStandings(
      ["A", "B", "C"],
      [m(1, "A", "B", "final", "A", 13, 7), m(2, "B", "C", "final", "B", 13, 11), m(3, "A", "C", "scheduled", null)]
    );
    assert.deepEqual(
      rows.map((r) => [r.teamId, r.points, r.played, r.rd]),
      [
        ["A", 3, 1, 6],
        ["B", 3, 2, -4],
        ["C", 0, 1, -2],
      ]
    );
  });

  it("breaks ties by head-to-head before round difference", () => {
    // A and B both 6 pts; B has the better RD but A beat B.
    const rows = league.computeStandings(
      ["A", "B", "C", "D"],
      [
        m(1, "A", "B", "final", "A", 13, 12),
        m(2, "A", "C", "final", "C", 5, 13),
        m(3, "A", "D", "final", "A", 13, 11),
        m(4, "B", "C", "final", "B", 13, 0),
        m(5, "B", "D", "final", "B", 13, 0),
        m(6, "C", "D", "final", "D", 12, 13),
      ]
    );
    assert.deepEqual(rows.slice(0, 2).map((r) => r.teamId), ["A", "B"]);
    assert.ok(rows[1].rd > rows[0].rd, "B's RD is better, head-to-head still wins");
  });

  it("a forfeit loss costs one round of difference", () => {
    const rows = league.computeStandings(["A", "B"], [m(1, "A", "B", "forfeit", "A")]);
    const b = rows.find((r) => r.teamId === "B")!;
    const a = rows.find((r) => r.teamId === "A")!;
    assert.deepEqual([a.points, a.rd, b.points, b.rd, b.lost], [3, 0, 0, -1, 1]);
  });

  it("week windows run Monday to Sunday with the default slot Sunday 20:00 UTC", () => {
    const monday = Date.UTC(2030, 0, 7);
    const w2 = league.weekWindow(monday, 2);
    assert.equal(new Date(w2.start).toISOString(), "2030-01-14T00:00:00.000Z");
    assert.equal(new Date(w2.end).toISOString(), "2030-01-20T23:59:59.999Z");
    assert.equal(new Date(league.defaultSlot(monday, 2)).toISOString(), "2030-01-20T20:00:00.000Z");
  });
});

describe("league page payload", () => {
  it("shows divisions, standings and the schedule for a started season", async () => {
    await reset();
    await openSeason("regular");
    const season = (await league.listSeasons())[0];
    await client.execute({
      sql: "UPDATE league_seasons SET start_date = ? WHERE id = ?",
      args: [Date.UTC(2030, 0, 7), season.id],
    });
    await client.execute({
      sql: "INSERT INTO league_divisions (season_id, name, tier) VALUES (?, 'Division 1', 1)",
      args: [season.id],
    });
    const div = (await league.seasonDivisions(season.id))[0];
    for (const [i, id] of ["aaa", "bbb", "ccc", "ddd"].entries()) {
      const ids = [100 + i * 10, 101 + i * 10, 102 + i * 10, 103 + i * 10, 104 + i * 10];
      await addTeam(id, ids);
      await client.execute({
        sql: `INSERT INTO league_entries (season_id, team_id, team_name, team_tag, captain_id, roster, seed_elo,
                division_id, status, signed_up_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        args: [
          season.id, id, `Team ${id}`, id.toUpperCase(), String(ids[0]),
          JSON.stringify(ids.map((x) => ({ discordId: String(x), playerName: `player${x}`, username: "", role: "starter" }))),
          2000 - i * 100, div.id, i,
        ],
      });
    }
    await client.execute({
      sql: `INSERT INTO league_matches (season_id, division_id, week, team_a, team_b, status, score_a, score_b, winner)
            VALUES (?, ?, 1, 'aaa', 'bbb', 'final', 13, 9, 'aaa'), (?, ?, 1, 'ccc', 'ddd', 'unscheduled', NULL, NULL, NULL),
                   (?, ?, 2, 'aaa', 'ccc', 'unscheduled', NULL, NULL, NULL)`,
      args: [season.id, div.id, season.id, div.id, season.id, div.id],
    });

    const view = await league.leagueView(null, "121"); // a ccc player
    assert.equal(view.season!.status, "regular");
    assert.deepEqual(view.viewer!.myTeamIds, ["ccc"]);
    const d = view.divisions[0];
    assert.equal(d.standings[0].teamId, "aaa");
    assert.equal(d.standings[0].points, 3);
    assert.deepEqual(d.weeks.map((w) => [w.week, w.matches.length]), [[1, 2], [2, 1]]);
    assert.equal(new Date(d.weeks[1].defaultSlot!).toISOString(), "2030-01-20T20:00:00.000Z");
    assert.equal(d.weeks[0].matches.find((x) => x.teamA.id === "ccc")!.mine, true);
    assert.equal(d.weeks[0].matches[0].teamA.name, "Team aaa");
  });
});
