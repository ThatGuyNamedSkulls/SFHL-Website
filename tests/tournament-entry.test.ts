/**
 * Entering a tournament requires owning (captaining) a saved team, and the
 * team that enters is linked by id so its titles can be counted.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("tourney");
let tournaments: typeof import("@/lib/tournaments");
let titles: typeof import("@/lib/team-titles");
let client: typeof import("@/lib/db").client;

const STAFF = { discordId: "900", username: "staff", playerName: null, avatar: null, staff: true };
const actor = (discordId: string, name: string) => ({
  discordId,
  username: name,
  playerName: name,
  avatar: null,
  staff: false,
});

async function team(id: string, name: string, tag: string, captainId: string) {
  const now = Date.now();
  const data = {
    id, name, tag, logoUrl: null, accentColor: "#ff5500", region: "EU",
    captainId, captainName: captainId, createdAt: now, updatedAt: now,
    members: [{ discordId: captainId, username: captainId, playerName: null, avatar: null,
                role: "captain", status: "accepted", joinedAt: now }],
  };
  await client.execute({
    sql: "INSERT OR REPLACE INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)",
    args: [id, JSON.stringify(data), now],
  });
}

async function coins(name: string) {
  const rs = await client.execute({ sql: "SELECT coins FROM players WHERE name = ?", args: [name] });
  return Number(rs.rows[0].coins);
}

let cupId = "";

before(async () => {
  tournaments = await import("@/lib/tournaments");
  titles = await import("@/lib/team-titles");
  client = (await import("@/lib/db")).client;
  const { MAP_NAMES } = await import("@/data/maps");
  // The bot owns players in production; this is the subset the site reads.
  await client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT, country TEXT,
    total_kills INTEGER, total_deaths INTEGER, total_assists INTEGER, kd_ratio REAL,
    total_mvps INTEGER, total_score INTEGER, total_headshot_percentage REAL, avg_hs_percent REAL,
    matches_played INTEGER, matches_won INTEGER, peak_elo INTEGER, total_play_time INTEGER,
    roblox_avatar_image TEXT, placement_done INTEGER DEFAULT 1, placement_games_played INTEGER,
    discord_id TEXT, discord_username TEXT, discord_avatar TEXT, mm_access INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0)`);
  await client.execute(`INSERT INTO players (name, discord_id, discord_username, coins) VALUES
    ('alice', '101', 'alice', 500), ('bob', '102', 'bob', 500), ('carol', '103', 'carol', 500)`);
  const { listTeams } = await import("@/lib/teams");
  await listTeams(); // creates web_teams
  await team("teamA", "Night Owls", "OWL", "101");
  await team("teamC", "Red Storm", "RED", "103");
  const cup = await tournaments.createTournament(
    { name: "Test Cup", kind: "official", region: "EU", bracket: "single", size: 8, bo: 1,
      entryFee: 100, mapPool: MAP_NAMES.slice(0, 1) },
    STAFF
  );
  cupId = cup.id;
});

after(async () => {
  await tmp.cleanup(["web_tournaments", "web_teams", "team_titles", "players"]);
});

describe("tournament entry needs a team", () => {
  it("refuses a player who captains no team, without charging", async () => {
    await assert.rejects(
      tournaments.requestJoin(cupId, actor("102", "bob"), ""),
      /Only team captains can join tournaments/
    );
    assert.equal(await coins("bob"), 500);
  });

  it("refuses a team the player doesn't captain", async () => {
    await assert.rejects(
      tournaments.requestJoin(cupId, actor("101", "alice"), "teamC"),
      /You don't captain that team/
    );
    assert.equal(await coins("alice"), 500);
  });

  it("enters the captain's saved team, charges the fee and links the team id", async () => {
    const t = await tournaments.requestJoin(cupId, actor("101", "alice"), "teamA");
    const req = t.requests.find((r) => r.captainId === "101")!;
    assert.equal(req.teamId, "teamA");
    assert.equal(req.teamName, "Night Owls");
    assert.equal(await coins("alice"), 400);
  });

  it("accepting keeps the link to the saved team", async () => {
    const t0 = await tournaments.getTournament(cupId);
    const req = t0!.requests.find((r) => r.captainId === "101")!;
    const t = await tournaments.reviewRequest(cupId, STAFF, req.id, true);
    assert.equal(t.teams[0].teamId, "teamA");
    assert.equal(t.teams[0].name, "Night Owls");
  });

  it("the same team can't enter twice", async () => {
    await assert.rejects(
      tournaments.requestJoin(cupId, actor("101", "alice"), "teamA"),
      /already on a team|already entered/
    );
  });

  it("a request is refused on accept if the team changed captain", async () => {
    await tournaments.requestJoin(cupId, actor("103", "carol"), "teamC");
    await team("teamC", "Red Storm", "RED", "999"); // captaincy moved away
    const t0 = await tournaments.getTournament(cupId);
    const req = t0!.requests.find((r) => r.captainId === "103")!;
    await assert.rejects(
      tournaments.reviewRequest(cupId, STAFF, req.id, true),
      /no longer exists or has a new captain/
    );
    await tournaments.reviewRequest(cupId, STAFF, req.id, false); // deny → refund
    assert.equal(await coins("carol"), 500);
  });
});

describe("team titles", () => {
  it("counts titles per team and lists them newest first", async () => {
    await titles.titlesForTeam("none"); // creates the table
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO team_titles (team_id, title, awarded_by, awarded_at) VALUES
            ('teamA', 'Season 1 Cup', 'staff', ?), ('teamA', 'Summer Major', 'staff', ?),
            ('teamC', 'Spring Open', 'staff', ?)`,
      args: [now - 1000, now, now],
    });
    const counts = await titles.titleCounts(["teamA", "teamC", "nobody"]);
    assert.equal(counts.get("teamA"), 2);
    assert.equal(counts.get("teamC"), 1);
    assert.equal(counts.get("nobody"), undefined);
    const list = await titles.titlesForTeam("teamA");
    assert.deepEqual(list.map((t) => t.title), ["Summer Major", "Season 1 Cup"]);
  });
});
