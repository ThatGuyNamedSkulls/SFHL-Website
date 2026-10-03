/**
 * The clan pages' data (docs/CLANS_UI_PLAN.md §5): members' ranks, matches
 * together this season (ranked only: no placements, dummies or last season),
 * season records, the clan payload every route returns, the list's card
 * numbers, /clans/<TAG> lookups and turning invite links off.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("clan-data");
let db: typeof import("@/lib/db");
let clubs: typeof import("@/lib/clubs");
let stats: typeof import("@/lib/clan-stats");
let payload: typeof import("@/lib/clan-payload");

const RESET = "2026-09-01 00:00:00";
const NOW = Date.UTC(2026, 9, 3, 12, 0);
const person = (discordId: string, playerName: string) => ({ discordId, username: playerName, playerName, avatar: null });
const ANA = person("1", "ana");
const BO = person("2", "bo");
const CY = person("3", "cy");
const DEE = person("4", "dee");
const EVE = person("5", "eve");

let nova = "";
let owl = "";

async function add(player: string, match: number, ts: string, result: "W" | "L", team: number | null, extra: { placement?: 1; test?: 1; kills?: number; deaths?: number } = {}) {
  await db.client.execute({
    sql: `INSERT INTO match_history (player_name, match_id, timestamp, result, team, map_name, round_score, kills, deaths, elo_change, is_placement, is_test)
          VALUES (?, ?, ?, ?, ?, 'de_mirage', '13,9', ?, ?, ?, ?, ?)`,
    args: [player, match, ts, result, team, extra.kills ?? 10, extra.deaths ?? 10, result === "W" ? 20 : -20, extra.placement ?? 0, extra.test ?? 0],
  });
}

before(async () => {
  db = await import("@/lib/db");
  clubs = await import("@/lib/clubs");
  stats = await import("@/lib/clan-stats");
  payload = await import("@/lib/clan-payload");
  await db.client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT DEFAULT '[?] Unranked',
    placement_done INTEGER DEFAULT 0, discord_id TEXT, discord_username TEXT, discord_avatar TEXT, country TEXT)`);
  await db.client.execute(`CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, player_name TEXT, match_id INTEGER, timestamp TEXT,
    result TEXT, team INTEGER, map_name TEXT, round_score TEXT, kills INTEGER, deaths INTEGER, elo_change INTEGER,
    is_placement INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0)`);
  await db.client.execute("CREATE TABLE season_resets (season_name TEXT, reset_at TEXT)");
  await db.client.execute({ sql: "INSERT INTO season_resets VALUES ('Season 1', ?)", args: [RESET] });
  await db.client.execute(`INSERT INTO players (name, elo, rank, placement_done, discord_id, country) VALUES
    ('ana', 1600, '[A3 | 1450-1649]', 1, '1', 'PT'),
    ('bo', 1400, '[A2 | 1250-1449]', 1, '2', 'br'),
    ('cy', 900, '[C | 800-949]', 0, '3', NULL),
    ('dee', 1000, '[B | 950-1099]', 1, '4', 'pl'),
    ('eve', 1200, '[A1 | 1100-1249]', 1, '5', NULL)`);

  nova = (await clubs.createClub({ name: "Nova Esports", tag: "NOVA", owner: ANA })).id;
  await clubs.joinClub(nova, BO);
  await clubs.joinClub(nova, CY);
  owl = (await clubs.createClub({ name: "Night Owls", tag: "OWL", private: true, owner: EVE })).id;
  await clubs.requestToJoin(owl, DEE);

  // This season: ana + bo won together (1), ana + cy lost together (2), ana and bo on opposite teams (3).
  await add("ana", 1, "2026-10-02 18:00:00", "W", 1, { kills: 20, deaths: 10 });
  await add("bo", 1, "2026-10-02 18:00:00", "W", 1);
  await add("dee", 1, "2026-10-02 18:00:00", "L", 2);
  await add("ana", 2, "2026-10-01 18:00:00", "L", 2, { kills: 5, deaths: 15 });
  await add("cy", 2, "2026-10-01 18:00:00", "L", 2);
  await add("ana", 3, "2026-09-15 18:00:00", "W", 1, { kills: 15, deaths: 5 });
  await add("bo", 3, "2026-09-15 18:00:00", "L", 2);
  // Not counted: last season, a placement game, a dummy match.
  await add("ana", 4, "2026-08-20 18:00:00", "W", 1);
  await add("bo", 4, "2026-08-20 18:00:00", "W", 1);
  await add("ana", 5, "2026-09-20 18:00:00", "W", 1, { placement: 1 });
  await add("bo", 5, "2026-09-20 18:00:00", "W", 1, { placement: 1 });
  await add("ana", 6, "2026-09-21 18:00:00", "W", 1, { test: 1 });
  await add("bo", 6, "2026-09-21 18:00:00", "W", 1, { test: 1 });
});

after(async () => {
  await tmp.cleanup(["web_clubs", "web_club_tag_pref", "web_tournaments", "players", "match_history", "season_resets", "notifications", "discord_dm_outbox", "web_users"]);
});

describe("clan queries", () => {
  it("members' players by Discord id or name, with rank, Elo and country", async () => {
    const players = await stats.memberPlayers([ANA, { discordId: "999", playerName: "BO" }, CY]);
    assert.equal(stats.playerFor(players, ANA)?.elo, 1600);
    assert.equal(stats.playerFor(players, ANA)?.rank, "A3");
    assert.equal(stats.playerFor(players, ANA)?.country, "pt");
    assert.equal(stats.playerFor(players, { discordId: "999", playerName: "BO" })?.name, "bo");
    const cy = stats.playerFor(players, CY)!;
    assert.equal(cy.placementDone, false);
    assert.equal(cy.elo, 0); // mid-placement: no public Elo
  });

  it("matches together this season: ranked, same team, 2+ members", async () => {
    const together = stats.groupTogether(await stats.togetherRows(["ana", "bo", "cy"], RESET));
    assert.deepEqual(
      together.map((m) => [m.matchId, m.result, m.players.join("+")]),
      [
        [1, "W", "ana+bo"],
        [2, "L", "ana+cy"],
      ]
    );
  });

  it("season records leave out placements, dummies and last season", async () => {
    const records = await stats.seasonRecords(["ana", "bo"], RESET);
    assert.deepEqual(records.get("ana"), { matches: 3, wins: 2, kills: 40, deaths: 30 });
    assert.equal(records.get("bo")?.matches, 2);
    assert.equal(records.get("bo")?.wins, 1);
  });

  it("matches together carry the members' Elo and rating once the scoreboard columns exist", async () => {
    // This test database starts without them, like an older one: no rating yet.
    const older = stats.groupTogether(await stats.togetherRows(["ana", "bo", "cy"], RESET));
    assert.equal(older[0].rating, null);
    for (const col of ["assists", "mvps", "points", "rounds_played", "elo_before"]) {
      await db.client.execute(`ALTER TABLE match_history ADD COLUMN ${col} INTEGER`);
    }
    await db.client.execute("UPDATE match_history SET elo_before = 1500, rounds_played = 22");
    const [won] = stats.groupTogether(await stats.togetherRows(["ana", "bo", "cy"], RESET));
    assert.equal(won.matchId, 1);
    assert.equal(won.elo, 1520); // 1500 before, +20 each
    assert.equal(won.best?.name, "ana"); // 20 / 10 against bo's 10 / 10
    assert.ok(won.rating != null && won.rating > 0);
  });
});

describe("clanPayload", () => {
  it("members with rank, Elo, matches together and this season's record", async () => {
    const club = (await clubs.getClub(nova))!;
    const data = await payload.clanPayload(club, ANA.discordId);
    const ana = data.club.members.find((m) => m.playerName === "ana")!;
    assert.equal(ana.role, "owner");
    assert.equal(ana.elo, 1600);
    assert.equal(ana.rank, "A3");
    assert.equal(ana.together, 2);
    assert.equal(ana.season.matches, 3);
    assert.equal(data.club.members.find((m) => m.playerName === "cy")!.together, 1);
    assert.deepEqual(data.stats, { members: 3, ranked: 2, avgElo: 1500, avgRank: "A3", together: 2, togetherWins: 1 });
    assert.deepEqual(data.season, { number: 2, label: "Season 2", startedAt: RESET });
  });

  it("the activity: matches together, joins and the creation, newest first", async () => {
    const club = (await clubs.getClub(nova))!;
    const data = await payload.clanPayload(club, null);
    const kinds = data.activity.map((e) => e.kind);
    assert.equal(kinds.filter((k) => k === "match").length, 2);
    assert.equal(kinds.filter((k) => k === "join").length, 2); // bo and cy, not the owner
    assert.equal(kinds.filter((k) => k === "created").length, 1);
    for (let i = 1; i < data.activity.length; i++) assert.ok(data.activity[i - 1].at >= data.activity[i].at);
  });

  it("requests (with rank) and invite links go to staff only", async () => {
    const club = (await clubs.getClub(owl))!;
    const staff = await payload.clanPayload(club, EVE.discordId);
    assert.equal(staff.club.requests.length, 1);
    assert.equal(staff.club.requests[0].playerName, "dee");
    assert.equal(staff.club.requests[0].rank, "B");
    const asker = await payload.clanPayload(club, DEE.discordId);
    assert.equal(asker.club.requests.length, 0);
    assert.equal(asker.club.requested, true);
  });
});

describe("tag links and invite links", () => {
  it("a clan opens by id or by tag, in any case", async () => {
    assert.equal((await clubs.getClubByTag("nova"))?.id, nova);
    assert.equal((await clubs.getClubByIdOrTag("NOVA"))?.id, nova);
    assert.equal((await clubs.getClubByIdOrTag(nova))?.tag, "NOVA");
    assert.equal(await clubs.getClubByIdOrTag("NOPE"), null);
    assert.equal(await clubs.getClubByIdOrTag("x"), null);
  });

  it("staff turn invite links off; links show who made them", async () => {
    const withLink = await clubs.createInvite(nova, ANA.discordId);
    const token = withLink.invites[0].token;
    const view = await payload.clanPayload(withLink, ANA.discordId);
    assert.equal(view.club.invites[0].createdByName, "ana");
    await assert.rejects(clubs.revokeInvite(nova, BO.discordId, token), /cannot manage invite links/);
    const after = await clubs.revokeInvite(nova, ANA.discordId, token);
    assert.equal(after.invites.some((i) => i.token === token), false);
  });
});

describe("clanListStats", () => {
  it("card numbers for every clan: first members, average Elo, matches together this week", async () => {
    const list = await clubs.listClubs();
    const out = await stats.clanListStats(
      list.map((c) => ({ id: c.id, members: clubs.sortMembersByRole(c) })),
      NOW
    );
    const n = out.get(nova)!;
    assert.deepEqual(n.preview.map((p) => p.name), ["ana", "bo", "cy"]);
    assert.equal(n.avgElo, 1500);
    assert.equal(n.ranked, 2);
    assert.deepEqual(n.week, ["2026-10-02 18:00:00", "2026-10-01 18:00:00"]);
    const o = out.get(owl)!;
    assert.equal(o.week.length, 0);
    assert.equal(o.avgElo, 1200);
  });
});
