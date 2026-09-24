/**
 * League UI step 1 (docs/LEAGUE_UI_PLAN.md): a live and an upcoming season at
 * once, invite-only named divisions (team access), season page details, the
 * season timeline and a team's country.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("league-seasons");
let admin: typeof import("@/lib/league-admin");
let league: typeof import("@/lib/league");
let timeline: typeof import("@/lib/league-timeline");
let client: typeof import("@/lib/db").client;

const TABLES = [
  "league_team_access", "league_events", "league_matches", "league_entries", "league_divisions",
  "league_seasons", "web_teams", "players",
];
const STAFF = { discordId: "900", name: "Mod" };
const DAY = 86_400_000;

before(async () => {
  admin = await import("@/lib/league-admin");
  league = await import("@/lib/league");
  timeline = await import("@/lib/league-timeline");
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

async function wipe() {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
}

async function addTeam(t: number, elo: number, country = "PT") {
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
    await client.execute({
      sql: "INSERT INTO players (name, elo, placement_done, country) VALUES (?, ?, 1, ?)",
      args: [`p${d}`, elo, country],
    });
  }
}

describe("two seasons at once", () => {
  it("the next season takes sign-ups while the live one is played", async () => {
    await wipe();
    for (let t = 0; t < 4; t++) await addTeam(t, 1300);
    const s1 = await admin.createSeason("Season 1", STAFF);
    await admin.openSignups(s1.id, 3, STAFF);
    for (let t = 0; t < 4; t++) await league.signUpTeam(`team${t}`, String(1000 + t * 10));
    await admin.closeSignups(s1.id, STAFF);
    await admin.startSeason(s1.id, "2099-01-05", STAFF, Date.UTC(2098, 0, 1));

    const s2 = await admin.createSeason("Season 2", STAFF);
    assert.equal((await league.liveSeason())!.id, s1.id);
    assert.equal((await league.upcomingSeason())!.id, s2.id);
    await assert.rejects(admin.createSeason("Season 3", STAFF), /Season 2 is already being set up/);

    await admin.openSignups(s2.id, 7, STAFF);
    for (let t = 0; t < 4; t++) await league.signUpTeam(`team${t}`, String(1000 + t * 10));
    await assert.rejects(admin.previewDraw(s2.id), /Finish Season 1 first/);
    await assert.rejects(admin.closeSignups(s2.id, STAFF), /Finish Season 1 first/);

    const view = await admin.adminView(null);
    assert.deepEqual([view.live?.name, view.upcoming?.name, view.season?.name], ["Season 1", "Season 2", "Season 1"]);
    assert.equal((await league.leagueView(null, null)).season!.id, s1.id, "the page opens on the live season");

    await admin.cancelSeason(s1.id, "Season 1", STAFF);
    await admin.closeSignups(s2.id, STAFF);
    assert.equal((await league.liveSeason())!.id, s2.id);
    assert.equal(await league.upcomingSeason(), null);
  });
});

describe("invite-only named divisions", () => {
  it("staff give access; everyone else plays in their Open band", async () => {
    await wipe();
    for (let t = 0; t < 8; t++) await addTeam(t, t < 4 ? 1000 : 2000);
    await assert.rejects(admin.setTeamAccess("team0", "legendary", STAFF), /Unknown division access/);
    for (let t = 0; t < 4; t++) await admin.setTeamAccess(`team${t}`, "main", STAFF);
    assert.equal((await league.teamAccessMap()).get("team0"), "main");

    const s = await admin.createSeason("S", STAFF);
    await admin.openSignups(s.id, 3, STAFF);
    for (let t = 0; t < 8; t++) await league.signUpTeam(`team${t}`, String(1000 + t * 10));
    const plan = await admin.previewDraw(s.id);
    assert.deepEqual(
      plan.divisions.map((d) => [d.name, d.code, d.teams.map((x) => x.teamId).sort()]),
      [
        ["Main", "main", ["team0", "team1", "team2", "team3"]],
        ["Open 8-9", "open89", ["team4", "team5", "team6", "team7"]],
      ]
    );
    assert.equal(plan.divisions[0].teams[0].access, "main");

    await admin.setTeamAccess("team0", null, STAFF);
    assert.equal((await league.teamAccessMap()).has("team0"), false);
    const kinds = (await admin.listEvents(null)).filter((e) => e.kind === "access_set").map((e) => e.detail);
    assert.ok(kinds.some((d) => d.includes("Team 0 → Open")) && kinds.some((d) => d.includes("Main Access")));
  });
});

describe("season page details", () => {
  it("staff edit the name, banner, description, rules and notice", async () => {
    await wipe();
    const s = await admin.createSeason("S", STAFF);
    await assert.rejects(
      admin.updateSeasonDetails(s.id, { bannerUrl: "javascript:alert(1)" }, STAFF),
      /https:\/\/ image link/
    );
    await admin.updateSeasonDetails(
      s.id,
      { name: " Season   4 ", bannerUrl: "https://cdn.example/banner.png", description: "Hi", rules: "Be nice", notice: "  " },
      STAFF
    );
    const got = (await league.getSeason(s.id))!;
    assert.deepEqual(
      [got.name, got.bannerUrl, got.description, got.rules, got.notice],
      ["Season 4", "https://cdn.example/banner.png", "Hi", "Be nice", null]
    );
    await admin.updateSeasonDetails(s.id, { notice: "Sign up now!" }, STAFF);
    assert.equal((await league.getSeason(s.id))!.rules, "Be nice", "fields not sent stay the same");
  });
});

describe("season timeline + team country", () => {
  it("plans the milestones and marks what already happened", () => {
    const start = Date.UTC(2099, 0, 5);
    const season = { id: 1, name: "S", status: "regular" as const, signupClose: start - 3 * DAY, startDate: start, weeks: 6 };
    const now = start + 10 * DAY;
    const list = timeline.seasonTimeline(season, { signups_opened: start - 10 * DAY, divisions_drawn: start - 3 * DAY }, now);
    assert.deepEqual(
      list.map((m) => [m.key, m.done]),
      [
        ["signups_open", true], ["signups_close", true], ["divisions", true], ["season_start", true],
        ["first_default", true], ["regular_end", false], ["playoffs_start", false], ["season_end", false],
      ]
    );
    assert.equal(list.find((m) => m.key === "first_default")!.at, Date.UTC(2099, 0, 11, 20));
    assert.deepEqual(timeline.timelineWindow(list).map((m) => m.key), ["first_default", "regular_end", "playoffs_start"]);

    // Staff pressed Start before week 1: the season hasn't started yet, and the
    // milestone shows week 1's date, not the click.
    const early = timeline.seasonTimeline(season, { season_started: start - 2 * DAY }, start - DAY);
    const s0 = early.find((m) => m.key === "season_start")!;
    assert.deepEqual([s0.at, s0.done], [start, false]);
  });

  it("a team's country is its players' most common country", async () => {
    await wipe();
    await addTeam(0, 1500, "PT");
    await client.execute("INSERT INTO players (name, elo, placement_done, country) VALUES ('px', 1500, 1, 'BR')");
    const got = await league.teamCountries(new Map([["team0", ["p1000", "p1001", "px"]], ["none", ["nobody"]]]));
    assert.deepEqual(Object.fromEntries(got), { team0: "PT", none: null });
  });
});

describe("Teams tab (UI step 5)", () => {
  it("lists every entry with country, league status, division and status", async () => {
    await wipe();
    const teamsLib = await import("@/lib/league-teams");
    for (let t = 0; t < 5; t++) await addTeam(t, t < 4 ? 1300 : 2000, t === 4 ? "BR" : "PT");
    for (let t = 0; t < 4; t++) await admin.setTeamAccess(`team${t}`, "main", STAFF);
    const s = await admin.createSeason("S", STAFF);
    await admin.openSignups(s.id, 3, STAFF);
    for (let t = 0; t < 5; t++) await league.signUpTeam(`team${t}`, String(1000 + t * 10));

    const before = await teamsLib.leagueTeams(s.id, "1000");
    assert.deepEqual(
      before.map((r) => [r.team.id, r.status, r.division, r.access, r.inviteOnly, r.country, r.mine]),
      [
        ["team0", "signed_up", null, "Main Access", true, "PT", true],
        ["team1", "signed_up", null, "Main Access", true, "PT", false],
        ["team2", "signed_up", null, "Main Access", true, "PT", false],
        ["team3", "signed_up", null, "Main Access", true, "PT", false],
        ["team4", "signed_up", null, "Open 8-9 Access", false, "BR", false],
      ]
    );
    assert.deepEqual(before[0].players, ["p1000", "p1001"]);
    assert.deepEqual([before[0].captain, before[1].captain], [true, false]);

    // JOIN NOW dialog data: each captained team says which division it would play in.
    const [c0] = (await league.leagueView(s.id, "1000")).viewer!.captainTeams;
    assert.deepEqual([c0.id, c0.signedUp, c0.access, c0.inviteOnly], ["team0", true, "Main Access", true]);
    const [c4] = (await league.leagueView(s.id, "1040")).viewer!.captainTeams;
    assert.deepEqual([c4.access, c4.inviteOnly], ["Open 8-9 Access", false]);

    // team4 adds an unlinked member before the rosters lock → not placed.
    const rs = await client.execute("SELECT data FROM web_teams WHERE id = 'team4'");
    const team4 = JSON.parse(String(rs.rows[0].data));
    team4.members.push({ discordId: "7777", username: "ghost", playerName: "", avatar: null, role: "starter", status: "accepted", joinedAt: 0 });
    await client.execute({ sql: "UPDATE web_teams SET data = ? WHERE id = 'team4'", args: [JSON.stringify(team4)] });
    await admin.closeSignups(s.id, STAFF);

    const after = await teamsLib.leagueTeams(s.id, null);
    assert.deepEqual(
      after.map((r) => [r.team.id, r.status, r.division?.name ?? null, r.mine]),
      [
        ["team0", "active", "Main", false],
        ["team1", "active", "Main", false],
        ["team2", "active", "Main", false],
        ["team3", "active", "Main", false],
        ["team4", "ineligible", null, false],
      ]
    );
    assert.match(after[4].note ?? "", /not linked to a player: ghost/i);
    assert.deepEqual(teamsLib.statusCounts(after), { all: 5, active: 4, signed_up: 0, ineligible: 1 });
    assert.equal(teamsLib.parseTeamsFilter("ineligible"), "ineligible");
    assert.equal(teamsLib.parseTeamsFilter("bogus"), "all");
    assert.equal(teamsLib.parseTeamsFilter(["active"]), "all");
  });
});
