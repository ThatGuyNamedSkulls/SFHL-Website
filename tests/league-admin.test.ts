/**
 * League → Manage (Match Staff on the website): the draw and schedule rules
 * match the bot (tests/league-vectors.json is generated from core/league.py),
 * the whole season flow runs from the website, steps can't run twice, and
 * staff can set results and move matches.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDb } from "./helpers/temp-db";

// Real roster rule (the live setting is 1 while the league is being tried out).
process.env.HL_LEAGUE_ROSTER_MIN = "5";
const tmp = createTempDb("league-admin");
let admin: typeof import("@/lib/league-admin");
let league: typeof import("@/lib/league");
let lm: typeof import("@/lib/league-matches");
let client: typeof import("@/lib/db").client;

const TABLES = [
  "league_events", "league_matches", "league_entries", "league_divisions", "league_seasons",
  "web_teams", "players", "bot_state", "discord_dm_outbox",
];
const STAFF = { discordId: "900", name: "Mod" };
const vectors = JSON.parse(readFileSync(join(__dirname, "league-vectors.json"), "utf-8"));

before(async () => {
  admin = await import("@/lib/league-admin");
  league = await import("@/lib/league");
  lm = await import("@/lib/league-matches");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await (await import("@/lib/social")).ensureSocialSchema();
  await client.execute("CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER)");
});

after(async () => {
  await tmp.cleanup(TABLES);
});

async function wipe() {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
}

async function addTeam(id: string, ids: number[], elo: number) {
  const team = {
    id, name: `Team ${id}`, tag: id.toUpperCase().slice(0, 5), logoUrl: null, accentColor: "#ff5500",
    region: "EU", captainId: String(ids[0]), captainName: `p${ids[0]}`,
    members: ids.map((i) => ({ discordId: String(i), username: `u${i}`, playerName: `p${i}`, avatar: null,
      role: "starter", status: "accepted", joinedAt: 0 })),
    createdAt: 0, updatedAt: 0,
  };
  await client.execute({ sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [id, JSON.stringify(team), 0] });
  for (const i of ids) {
    await client.execute({ sql: "INSERT INTO players (name, elo, placement_done) VALUES (?, ?, 1)", args: [`p${i}`, elo] });
  }
}

describe("draw and schedule rules match the bot", () => {
  it("division sizes", () => {
    for (const [n, sizes] of Object.entries(vectors.divisionSizes)) {
      assert.deepEqual(admin.divisionSizes(Number(n)), sizes, `${n} teams`);
    }
    for (const n of vectors.divisionSizesTooFew) assert.throws(() => admin.divisionSizes(n), /At least 4/);
  });

  it("round-robin schedules for 4–7 teams", () => {
    for (const [n, games] of Object.entries(vectors.schedules)) {
      const ids = Array.from({ length: Number(n) }, (_, i) => `t${i}`);
      assert.deepEqual(admin.seasonSchedule(ids), games, `${n} teams`);
    }
  });

  it("Mondays, week windows and the default slot", () => {
    for (const { after: a, monday } of vectors.nextMonday) {
      assert.equal(new Date(admin.nextMonday(Date.parse(a))).toISOString(), monday, a);
    }
    for (const { text, monday } of vectors.firstWeek) {
      assert.equal(new Date(admin.parseFirstWeek(text, Date.UTC(2098, 0, 1))).toISOString(), monday, text);
    }
    for (const w of vectors.weeks) {
      assert.deepEqual(league.weekWindow(vectors.seasonStart, w.week), { start: w.start, end: w.end });
      assert.equal(league.defaultSlot(vectors.seasonStart, w.week), w.defaultSlot);
    }
    assert.throws(() => admin.parseFirstWeek("05/10/2030"), /YYYY-MM-DD/);
    assert.throws(() => admin.parseFirstWeek("2020-01-06", Date.UTC(2026, 0, 1)), /past/);
  });
});

describe("running a season from the website", () => {
  it("create → sign-ups → preview + draw → move → preview + start → cancel", async () => {
    await wipe();
    const season = await admin.createSeason("  Season   1 ", STAFF);
    assert.equal(season.name, "Season 1");
    await assert.rejects(admin.createSeason("", STAFF), /already running/);

    await admin.openSignups(season.id, 7, STAFF);
    assert.equal((await league.getSeason(season.id))!.status, "signup");

    for (let t = 0; t < 9; t++) {
      const ids = [100 + t * 10, 101 + t * 10, 102 + t * 10, 103 + t * 10, 104 + t * 10];
      await addTeam(`team${t}`, ids, 2400 - t * 100);
      await league.signUpTeam(`team${t}`, String(ids[0]));
    }
    await addTeam("joke", [700, 701, 702, 703, 704], 1000);
    await league.signUpTeam("joke", "700");
    await admin.removeEntry(season.id, "joke", STAFF);

    const preview = await admin.previewDraw(season.id);
    assert.deepEqual(preview.divisions.map((d) => d.teams.length), [5, 4]);
    assert.equal(preview.divisions[0].teams[0].teamId, "team0", "strongest on top");
    assert.equal((await league.getSeason(season.id))!.status, "signup", "preview writes nothing");

    const drawn = await admin.closeSignups(season.id, STAFF);
    assert.deepEqual(drawn, preview, "the draw is what the preview showed");
    await assert.rejects(admin.closeSignups(season.id, STAFF), /isn't taking sign-ups/);

    const divs = await league.seasonDivisions(season.id);
    await admin.moveTeam(season.id, "team4", divs[1].id, STAFF);
    await admin.moveTeam(season.id, "team3", divs[1].id, STAFF);
    const bad = await admin.previewStart(season.id, "2099-01-05");
    assert.equal(bad.ok, false);
    assert.match(bad.divisions[0].problem!, /3 teams/);
    await assert.rejects(admin.startSeason(season.id, "2099-01-05", STAFF), /needs 4–7/);
    await admin.moveTeam(season.id, "team3", divs[0].id, STAFF);

    const plan = await admin.previewStart(season.id, "2099-01-07"); // a Wednesday → next Monday
    assert.equal(new Date(plan.firstWeek).toISOString(), "2099-01-12T00:00:00.000Z");
    assert.deepEqual(plan.divisions.map((d) => [d.teams, d.matches]), [[4, 12], [5, 10]]);
    await admin.startSeason(season.id, "2099-01-07", STAFF);
    const started = (await league.getSeason(season.id))!;
    assert.equal(started.status, "regular");
    assert.equal(started.startDate, Date.UTC(2099, 0, 12));
    assert.equal((await league.seasonMatches(season.id)).length, 22);
    await assert.rejects(admin.startSeason(season.id, "2099-01-07", STAFF), /Close sign-ups first/);

    await assert.rejects(admin.cancelSeason(season.id, "season 1", STAFF), /Type the season name/);
    await admin.cancelSeason(season.id, "Season 1", STAFF);
    assert.equal((await league.getSeason(season.id))!.status, "cancelled");

    const kinds = (await admin.listEvents(season.id)).map((e) => e.kind).reverse();
    assert.deepEqual(kinds, [
      "season_created", "signups_opened", "team_removed", "divisions_drawn", "team_moved", "team_moved",
      "team_moved", "season_started", "season_cancelled",
    ]);
    const unposted = await client.execute("SELECT kind FROM league_events WHERE announced = 0 ORDER BY id");
    assert.deepEqual(unposted.rows.map((r) => r.kind), [
      "signups_opened", "divisions_drawn", "season_started", "season_cancelled",
    ], "only the big steps wait for the bot to post them");
  });

  it("a step already done from Discord isn't done twice", async () => {
    await wipe();
    const season = await admin.createSeason("S", STAFF);
    // Discord cancels first; the website's open-sign-ups click then fails cleanly.
    await client.execute({ sql: "UPDATE league_seasons SET status = 'cancelled' WHERE id = ?", args: [season.id] });
    await assert.rejects(admin.openSignups(season.id, 7, STAFF), /already past sign-ups/);
  });

  it("saves the league channel for the bot", async () => {
    await wipe();
    await assert.rejects(admin.setLeagueChannel("general", "general", STAFF), /Pick a channel/);
    await admin.setLeagueChannel("123456789012", "league-results", STAFF);
    assert.equal(await admin.getLeagueChannelId(), "123456789012");
  });
});

describe("Match Staff on a match", () => {
  async function liveSeason() {
    await wipe();
    const now = Date.now();
    const s = await client.execute({
      sql: "INSERT INTO league_seasons (name, status, start_date, weeks, created_at, updated_at) VALUES ('S', 'regular', ?, 6, 0, 0)",
      args: [Date.UTC(2099, 0, 5)],
    });
    const seasonId = Number(s.lastInsertRowid);
    for (const [id, cap] of [["aaa", 10], ["bbb", 20]] as const) {
      await addTeam(id, [cap, cap + 1], 1500);
      await client.execute({
        sql: `INSERT INTO league_entries (season_id, team_id, team_name, captain_id, roster, status, signed_up_at)
              VALUES (?, ?, ?, ?, ?, 'active', 0)`,
        args: [seasonId, id, `Team ${id}`, String(cap),
          JSON.stringify([{ discordId: String(cap), playerName: `p${cap}`, username: "", role: "starter" },
            { discordId: String(cap + 1), playerName: `p${cap + 1}`, username: "", role: "starter" }])],
      });
    }
    const m = await client.execute({
      sql: `INSERT INTO league_matches (season_id, week, team_a, team_b, status, note, reported_at, score_a, score_b, winner, result_kind)
            VALUES (?, 1, 'aaa', 'bbb', 'disputed', 'they had 6', ?, 13, 7, 'aaa', 'score')`,
      args: [seasonId, now - 13 * 3_600_000],
    });
    return { seasonId, matchId: Number(m.lastInsertRowid) };
  }

  it("lists the dispute, then settles it", async () => {
    const { seasonId, matchId } = await liveSeason();
    const needs = await admin.needsStaff(seasonId);
    assert.equal(needs.length, 1);
    assert.match(needs[0].reason, /Disputed — they had 6/);

    await assert.rejects(lm.staffSetResult(matchId, { winner: "aaa", scoreA: 7, scoreB: 13 }, STAFF), /higher score/);
    await lm.staffSetResult(matchId, { winner: "bbb", scoreA: 7, scoreB: 13 }, STAFF);
    const m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.winner, m.confirmedBy, m.note], ["final", "bbb", "staff:900", null]);
    assert.deepEqual(await admin.needsStaff(seasonId), []);

    await lm.staffSetResult(matchId, { winner: "aaa", forfeit: true }, STAFF);
    assert.deepEqual([(await lm.getLeagueMatch(matchId))!.status, (await lm.getLeagueMatch(matchId))!.scoreA], ["forfeit", null]);
  });

  it("moves an unplayed match and DMs both rosters", async () => {
    const { matchId } = await liveSeason();
    await client.execute({ sql: "UPDATE league_matches SET status = 'unscheduled' WHERE id = ?", args: [matchId] });
    const when = Date.UTC(2099, 0, 8, 19);
    await lm.staffReschedule(matchId, when, STAFF);
    const m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.scheduledAt], ["scheduled", when]);
    const dms = await client.execute("SELECT discord_id FROM discord_dm_outbox ORDER BY discord_id");
    assert.deepEqual(dms.rows.map((r) => String(r.discord_id)), ["10", "11", "20", "21"]);
    await assert.rejects(lm.staffReschedule(matchId, Date.now() - 1000, STAFF), /past/);
  });
});
