/**
 * Team roster slots (docs/LEAGUE_V2_PLAN.md D2): 5 main roster (captain
 * included) + 6 subs + 1 coach; invites take the first free slot; role changes
 * respect the caps; the coach can't captain and isn't on the league roster;
 * the player-card data and the skill-level range helpers.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("team-roster");
let roster: typeof import("@/lib/team-roster");
let teams: typeof import("@/lib/teams");
let league: typeof import("@/lib/league");
let card: typeof import("@/lib/player-card");
let rules: typeof import("@/lib/league-find-rules");
let stats: typeof import("@/lib/team-stats");

before(async () => {
  roster = await import("@/lib/team-roster");
  teams = await import("@/lib/teams");
  league = await import("@/lib/league");
  card = await import("@/lib/player-card");
  rules = await import("@/lib/league-find-rules");
  stats = await import("@/lib/team-stats");
});

after(async () => {
  await tmp.cleanup(["web_teams"]);
});

const person = (id: string) => ({ discordId: id, username: `u${id}`, playerName: `p${id}`, avatar: null });

describe("roster slots", () => {
  it("12 members: 5 main, 6 subs, 1 coach; invites hold a slot", () => {
    assert.equal(roster.MAX_TEAM_MEMBERS, 12);
    const m = (id: string, role: string, status = "accepted") => ({ discordId: id, role, status });
    const team = [m("1", "captain"), m("2", "starter"), m("3", "starter"), m("4", "starter"), m("5", "starter", "invited")];
    assert.deepEqual(roster.slotCounts(team), { starter: 5, sub: 0, coach: 0 });
    assert.equal(roster.openSlot(team), "sub");
    assert.equal(roster.hasRoom(team, "starter", "2"), true, "moving player 2 frees their own slot");
    assert.equal(roster.openSlot([...team, ...["a", "b", "c", "d", "e", "f"].map((id) => m(id, "sub"))]), null);
    assert.equal(roster.isPlayer("coach"), false);
  });

  it("invites, role changes, the coach and captain transfer", async () => {
    let t = await teams.createTeam({ name: "Slots", tag: "SLT", captain: person("100") });
    for (let i = 1; i <= 4; i++) t = await teams.inviteToTeam(t.id, "100", person(String(100 + i)));
    t = await teams.inviteToTeam(t.id, "100", person("105"));
    assert.deepEqual(t.members.map((x) => x.role), ["captain", "starter", "starter", "starter", "starter", "sub"]);
    await assert.rejects(teams.inviteToTeam(t.id, "100", person("106"), "starter"), /main roster is full/);
    t = await teams.inviteToTeam(t.id, "100", person("107"), "coach");
    await assert.rejects(teams.inviteToTeam(t.id, "100", person("108"), "coach"), /already has a coach/);
    for (const id of ["101", "105", "107"]) t = (await teams.respondToInvite(t.id, id, true))!;
    await assert.rejects(teams.setMemberRole(t.id, "100", "105", "starter"), /main roster is full/);
    t = await teams.setMemberRole(t.id, "100", "101", "sub");
    t = await teams.setMemberRole(t.id, "100", "105", "starter");
    await assert.rejects(teams.transferCaptain(t.id, "100", "107"), /must be a player/);
    t = await teams.transferCaptain(t.id, "100", "101");
    assert.deepEqual(
      [t.captainId, t.members.find((x) => x.discordId === "100")!.role],
      ["101", "sub"],
      "the old captain takes the new captain's bench slot"
    );
    // The league roster is the players: the coach is left out.
    const { roster: leagueRoster } = league.rosterFromTeam(t);
    assert.deepEqual(leagueRoster.map((r) => r.discordId).sort(), ["100", "101", "105"]);
    assert.equal(league.ROSTER_MAX, 11);
  });
});

describe("player cards and skill levels", () => {
  it("the ring is the rank colour, filled by progress through the rank", () => {
    assert.deepEqual(card.rankRing(null), { rank: "UNRANKED", color: "#555555", progress: 0 });
    const s2 = card.rankRing(2050); // S2 = 1900–2199
    assert.deepEqual([s2.rank, s2.progress], ["S2", 0.5]);
    assert.equal(card.rankRing(4000).progress, 1, "★ is always full");
    const c = card.cardFromMember(
      { discordId: "1", username: "u1", playerName: "p1", avatar: null, role: "coach" },
      { row: { elo: 1500, placement_done: 1, country: "PT" }, tag: "HL", viewerId: "1" }
    );
    assert.deepEqual([c.tag, c.country, c.coach, c.me, c.verified, c.rank], ["HL", "pt", true, true, true, "A3"]);
  });

  it("levels 1–10 are the rank tiers between 100 and 9999", () => {
    assert.equal(rules.LEVELS.length, 10);
    assert.deepEqual([rules.LEVELS[0].min, rules.LEVELS[9].max], [100, 9999]);
    assert.equal(rules.levelOf(1500), 6); // A3 = 1450–1649
    assert.deepEqual(rules.levelBounds(8, 3), { minElo: rules.LEVELS[2].min, maxElo: rules.LEVELS[7].max });
    assert.deepEqual(rules.rangeLevels(null, null), [1, 10]);
    assert.deepEqual(rules.cleanRange(100, 9999), { minElo: null, maxElo: null }, "the full range = any");
    assert.deepEqual(rules.cleanRange(3000, 1200), { minElo: 1200, maxElo: 3000 });
    assert.equal(rules.rangeLabel({ minElo: null, maxElo: null }), "Any skill level");
    assert.equal(rules.rangeLabel({ minElo: 1250, maxElo: 1899 }), "Level 5–7 · 1,250–1,899");
  });
});

describe("team page stats (D4)", () => {
  const opp = { id: "o", name: "Other", tag: "OT", logoUrl: null, accentColor: "#fff" };
  const match = (id: number, result: "W" | "L" | null, week: number) => ({
    id, seasonId: 1, seasonName: "Season 1", division: "Main", date: week * 1000, stage: "regular", round: null,
    opponent: opp, result, forfeit: false, scoreFor: 13, scoreAgainst: 7, maps: [],
  });
  const line = (matchId: number, player: string, map: string, won: boolean, kills: number, deaths: number) => ({
    matchId, mapNo: 1, map, player, kills, deaths, hs: 50, score: kills * 2, roundsWon: won ? 13 : 7, roundsLost: won ? 7 : 13,
  });

  it("record, longest streak, recent form, maps and the chart", () => {
    const matches = [match(1, "W", 1), match(2, "W", 2), match(3, "L", 3), match(4, "W", 4), match(5, "W", 5), match(6, "W", 6), match(7, null, 7)];
    const lines = [
      line(1, "ana", "Mirage", true, 20, 10), line(1, "bo", "Mirage", true, 10, 10),
      line(3, "ana", "Nuke", false, 8, 16),
      line(6, "ana", "Mirage", true, 15, 5),
    ];
    const s = stats.summarizeTeam(matches, lines);
    assert.deepEqual([s.played, s.won, s.winRate, s.longestStreak], [6, 5, 83, 3]);
    assert.deepEqual(s.recent, ["W", "W", "W", "L", "W"], "newest first; the unplayed match doesn't count");
    assert.deepEqual(s.maps, [
      { map: "Mirage", played: 2, wins: 2, winRate: 100 },
      { map: "Nuke", played: 1, wins: 0, winRate: 0 },
    ]);
    assert.deepEqual(s.playerMaps.bo, [{ map: "Mirage", played: 1, wins: 1, winRate: 100 }]);
    assert.deepEqual(s.performance.players, ["ana", "bo"]);
    assert.deepEqual(s.performance.points.map((p) => [p.matchId, p.values.ana?.kd, p.values.bo?.kd]), [
      [1, 2, 1],
      [3, 0.5, undefined],
      [6, 3, undefined],
    ]);
  });
});
