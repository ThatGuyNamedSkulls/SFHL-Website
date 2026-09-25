/**
 * League UI step 7 (docs/LEAGUE_UI_PLAN.md): the Find Teammates board —
 * post rules and filters, then posts → apply → captain accepts (team invite)
 * or declines → notifications + Discord DMs, messages with a rate limit.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("league-find");
let rules: typeof import("@/lib/league-find-rules");
let find: typeof import("@/lib/league-find");
let admin: typeof import("@/lib/league-admin");
let league: typeof import("@/lib/league");
let teams: typeof import("@/lib/teams");
let client: typeof import("@/lib/db").client;

const TABLES = [
  "league_applications", "league_player_posts", "league_team_posts", "league_team_access",
  "league_events", "league_matches", "league_entries", "league_divisions", "league_seasons",
  "web_teams", "players", "notifications", "discord_dm_outbox",
];
const STAFF = { discordId: "900", name: "Mod" };
const viewer = (id: string, name: string | null = `p${id}`) => ({ discordId: id, playerName: name, username: `u${id}`, avatar: null });
const TEAM_POST = { title: "Need an AWP", body: "Weeknights", roles: ["awp", "bogus", "igl"], days: ["fri", "mon"], times: ["evening"], language: "pt", minElo: 1000, maxElo: 2000 };
const PLAYER_POST = { title: "Entry player LFT", roles: ["entry"], divisions: ["main", "nope"], language: "en" };

before(async () => {
  rules = await import("@/lib/league-find-rules");
  find = await import("@/lib/league-find");
  admin = await import("@/lib/league-admin");
  league = await import("@/lib/league");
  teams = await import("@/lib/teams");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await teams.listTeams();
  await (await import("@/lib/social")).ensureSocialSchema();
  await client.execute(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER, country TEXT, rank TEXT)"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

async function wipe() {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
}

async function addTeam(t: number, memberIds: string[], elo = 1500) {
  const team = {
    id: `team${t}`, name: `Team ${t}`, tag: `T${t}`, logoUrl: null, accentColor: "#ff5500", region: "EU",
    captainId: memberIds[0], captainName: `p${memberIds[0]}`,
    // Roster slots (lib/team-roster.ts): the first 5 are the main roster, the rest subs.
    members: memberIds.map((d, i) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
      role: i === 0 ? "captain" : i < 5 ? "starter" : "sub", status: "accepted", joinedAt: 0 })),
    createdAt: 0, updatedAt: 0,
  };
  await client.execute({ sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [team.id, JSON.stringify(team), t] });
  for (const d of memberIds) await addPlayer(d, elo);
}

async function addPlayer(id: string, elo: number, country = "pt") {
  await client.execute({
    sql: "INSERT INTO players (name, elo, placement_done, country, rank) VALUES (?, ?, 1, ?, 'A1')",
    args: [`p${id}`, elo, country],
  });
}

async function openSeason() {
  const s = await admin.createSeason("Season 9", STAFF);
  await admin.openSignups(s.id, 7, STAFF);
  return s.id;
}

const notes = async (name: string) =>
  (await client.execute({ sql: "SELECT type, message, ref_id FROM notifications WHERE player_name = ? ORDER BY id", args: [name] }))
    .rows.map((r) => ({ type: String(r.type), message: String(r.message), ref: String(r.ref_id) }));
const dms = async (id: string) =>
  (await client.execute({ sql: "SELECT message FROM discord_dm_outbox WHERE discord_id = ? ORDER BY id", args: [id] })).rows.map((r) => String(r.message));

describe("post rules and filters", () => {
  it("normalizes posts: known codes in canonical order, required title and roles, Elo range", () => {
    const t = rules.normalizeTeamPost(TEAM_POST);
    assert.deepEqual([t.roles, t.days, t.times, t.language, t.minElo, t.maxElo], [["igl", "awp"], ["mon", "fri"], ["evening"], "pt", 1000, 2000]);
    assert.throws(() => rules.normalizeTeamPost({ ...TEAM_POST, title: "hi" }), /title/);
    assert.throws(() => rules.normalizeTeamPost({ ...TEAM_POST, roles: ["bogus"] }), /at least one role/);
    assert.throws(() => rules.normalizeTeamPost({ ...TEAM_POST, minElo: 2500 }), /can't be above/);
    assert.throws(() => rules.normalizeTeamPost({ ...TEAM_POST, minElo: -5 }), /positive/);
    assert.equal(rules.normalizeTeamPost({ ...TEAM_POST, maxElo: 99999 }).maxElo, rules.ELO_MAX);
    const p = rules.normalizePlayerPost({ ...PLAYER_POST, language: "klingon" });
    assert.deepEqual([p.divisions, p.language, p.body], [["main"], null, null]);
    assert.equal(rules.normalizePlayerPost({ ...PLAYER_POST, title: "  lots   of   space  " }).title, "lots of space");
    assert.throws(() => rules.normalizeMessage(" "), /Write a message/);
  });

  it("parses filters and matches posts", () => {
    const f = rules.parseFindFilters({ tab: "players", division: "main", role: "awp", minElo: "1200", maxElo: "abc", language: "zz" });
    assert.deepEqual(f, { tab: "players", division: "main", language: null, role: "awp", minElo: 1200, maxElo: null });
    assert.equal(rules.parseFindFilters({}).tab, "teams");
    const team = { roles: ["awp"], language: "pt", division: "main", minElo: 1000, maxElo: 1100 };
    assert.equal(rules.teamPostMatches(team, f), false, "wanted range ends below the filter's minimum");
    assert.equal(rules.teamPostMatches({ ...team, maxElo: null }, f), true);
    assert.equal(rules.teamPostMatches({ ...team, division: "open57", maxElo: null }, f), false);
    const player = { roles: ["awp", "igl"], language: "en", divisions: [] as string[], elo: 1300 };
    assert.equal(rules.playerPostMatches(player, f), true, "no target divisions = any division");
    assert.equal(rules.playerPostMatches({ ...player, elo: null }, f), false, "unranked is below 1200");
    assert.equal(rules.playerPostMatches({ ...player, divisions: ["pro"] }, f), false);
  });
});

describe("the board", () => {
  it("posts → apply → accept (team invite) / decline, with notifications and DMs", async () => {
    await wipe();
    const seasonId = await openSeason();
    await addTeam(0, ["1000", "1001"], 1500);
    await addPlayer("5000", 1600, "br");
    await addPlayer("6000", 1400);

    await assert.rejects(find.saveTeamPost(seasonId, "team0", viewer("1001"), TEAM_POST), /Only the team captain/);
    await find.saveTeamPost(seasonId, "team0", viewer("1000"), TEAM_POST);
    await find.saveTeamPost(seasonId, "team0", viewer("1000"), { ...TEAM_POST, title: "Need an AWP now" }); // edit = upsert
    await assert.rejects(find.saveTeamPost(seasonId, "team0", viewer("1000"), { ...TEAM_POST, body: "no shit" }), /friendly/);

    const [tp] = await find.listTeamPosts(seasonId, "5000");
    assert.deepEqual(
      [tp.title, tp.division, tp.divisionLabel, tp.members, tp.joinable, tp.seedElo, tp.mine, tp.applied],
      ["Need an AWP now", "open57", "Open 5-7 Access", 2, true, 1500, false, null]
    );
    assert.equal((await find.listTeamPosts(seasonId, "1000"))[0].mine, true);

    await assert.rejects(find.savePlayerPost(seasonId, viewer("7000", null), PLAYER_POST), /Link your HyperLeague player/);
    await find.savePlayerPost(seasonId, viewer("5000"), PLAYER_POST);
    const [pp] = await find.listPlayerPosts(seasonId, null);
    assert.deepEqual([pp.playerName, pp.elo, pp.rank, pp.country, pp.divisions, pp.signedUpWith], ["p5000", 1600, "A1", "br", ["main"], null]);
    assert.equal(await find.findCount(seasonId), 2);

    // Apply: the captain hears about it on the website and on Discord.
    await find.applyToTeam(seasonId, "team0", viewer("5000"), "I play AWP");
    await assert.rejects(find.applyToTeam(seasonId, "team0", viewer("5000"), ""), /already applied/);
    await assert.rejects(find.applyToTeam(seasonId, "team0", viewer("1001"), ""), /already on this team/);
    const [n1] = await notes("p1000");
    assert.equal(n1.type, "league");
    assert.match(n1.message, /p5000 applied to join Team 0 for Season 9\. "I play AWP"/);
    assert.equal(n1.ref, `/league/${seasonId}/find?tab=teams`);
    assert.match((await dms("1000"))[0], /p5000 applied to join Team 0/);
    assert.equal((await find.listTeamPosts(seasonId, "5000"))[0].applied, "pending");

    const mine = await find.myRecruiting(seasonId, viewer("1000"));
    assert.equal(mine.captainTeams.length, 1);
    const [app] = mine.captainTeams[0].applications;
    assert.deepEqual([app.playerName, app.message, app.elo], ["p5000", "I play AWP", 1600]);

    // Only the captain answers; accepting sends the normal team invite.
    await assert.rejects(find.decideApplication(app.id, viewer("1001"), true), /Only the team captain/);
    await find.decideApplication(app.id, viewer("1000"), true);
    await assert.rejects(find.decideApplication(app.id, viewer("1000"), false), /already answered/);
    const team = (await teams.getTeam("team0"))!;
    assert.deepEqual(team.members.find((m) => m.discordId === "5000")?.status, "invited");
    const [accepted] = await notes("p5000");
    assert.match(accepted.message, /Team 0 accepted your application/);
    assert.equal(accepted.ref, "/teams/team0");
    assert.equal((await find.myRecruiting(seasonId, viewer("5000"))).myApplications[0].status, "accepted");

    // Decline: the player is told, and can't apply to that team again.
    await find.applyToTeam(seasonId, "team0", viewer("6000"), null);
    const declined = (await find.myRecruiting(seasonId, viewer("1000"))).captainTeams[0].applications[0];
    await find.decideApplication(declined.id, viewer("1000"), false);
    assert.match((await notes("p6000"))[0].message, /Team 0 declined your application/);
    await assert.rejects(find.applyToTeam(seasonId, "team0", viewer("6000"), null), /declined your application/);
  });

  it("withdrawing, removing a post, full teams and closed recruiting", async () => {
    await wipe();
    const seasonId = await openSeason();
    // 5 main + 6 subs = no player slot left (only the coach's, which you can't apply for).
    await addTeam(1, Array.from({ length: 11 }, (_, i) => String(1100 + i)));
    await addTeam(2, ["1200"]);
    await addPlayer("5100", 1500);
    await find.saveTeamPost(seasonId, "team1", viewer("1100"), TEAM_POST);
    await find.saveTeamPost(seasonId, "team2", viewer("1200"), TEAM_POST);
    assert.equal((await find.listTeamPosts(seasonId, null)).find((p) => p.team.id === "team1")!.joinable, false);
    await assert.rejects(find.applyToTeam(seasonId, "team1", viewer("5100"), null), /full/);

    await find.applyToTeam(seasonId, "team2", viewer("5100"), null);
    const [a] = (await find.myRecruiting(seasonId, viewer("5100"))).myApplications;
    await assert.rejects(find.withdrawApplication(a.id, viewer("9999")), /No pending application/);
    await find.withdrawApplication(a.id, viewer("5100"));
    await find.applyToTeam(seasonId, "team2", viewer("5100"), "again"); // withdrawn → can apply again

    await find.deleteTeamPost(seasonId, "team2", viewer("1200"));
    assert.equal((await find.myRecruiting(seasonId, viewer("5100"))).myApplications[0].status, "withdrawn");
    await assert.rejects(find.applyToTeam(seasonId, "team2", viewer("5100"), null), /isn't recruiting/);

    // Once the season is no longer upcoming (drawn, or cancelled here) the board is closed.
    await admin.cancelSeason(seasonId, "Season 9", STAFF);
    await assert.rejects(find.saveTeamPost(seasonId, "team2", viewer("1200"), TEAM_POST), /Recruiting is closed/);
    await assert.rejects(find.savePlayerPost(seasonId, viewer("5100"), PLAYER_POST), /Recruiting is closed/);
  });

  it("messages: DM + notification, not to yourself, 5 an hour", async () => {
    await wipe();
    const seasonId = await openSeason();
    await addTeam(3, ["1300"]);
    await addPlayer("5300", 1500);
    await find.savePlayerPost(seasonId, viewer("5300"), PLAYER_POST);
    const [pp] = await find.listPlayerPosts(seasonId, null);

    await assert.rejects(find.messagePlayer(seasonId, pp.id, viewer("5300"), "hello"), /your own post/);
    await assert.rejects(find.messagePlayer(seasonId, pp.id, viewer("1300"), "you piss me off"), /friendly/);
    const now = Date.now();
    for (let i = 0; i < rules.MESSAGES_PER_HOUR; i++) await find.messagePlayer(seasonId, pp.id, viewer("1300"), `hi ${i}`, now);
    await assert.rejects(find.messagePlayer(seasonId, pp.id, viewer("1300"), "one more", now), /5 messages an hour/);

    const [first] = await notes("p5300");
    assert.equal(first.type, "league_message");
    assert.match(first.message, /p1300 \(captain of Team 3\) messaged you about your Season 9 Find Teammates post: "hi 0"/);
    assert.equal(first.ref, `/league/${seasonId}/find?tab=players`);
    const dm = await dms("5300");
    assert.equal(dm.length, rules.MESSAGES_PER_HOUR);
    assert.match(dm[0], /Reply to them on Discord \(@u1300\)/);
  });
});
