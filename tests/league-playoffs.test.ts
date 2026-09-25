/**
 * League phase 4 on the website: the playoff/season-end rules match the bot
 * (tests/league-vectors.json), and Match Staff can run the playoffs and end a
 * season from the website — titles and prizes (no promotion/relegation).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("league-playoffs");
let lp: typeof import("@/lib/league-playoffs");
let admin: typeof import("@/lib/league-admin");
let league: typeof import("@/lib/league");
let lm: typeof import("@/lib/league-matches");
let client: typeof import("@/lib/db").client;

const TABLES = [
  "league_team_access",
  "league_events", "league_matches", "league_entries", "league_divisions", "league_seasons",
  "web_teams", "players", "team_titles", "discord_dm_outbox", "bot_state",
];
const STAFF = { discordId: "900", name: "Mod" };
const vectors = JSON.parse(readFileSync(join(__dirname, "league-vectors.json"), "utf-8"));

type Game = { team_a: string; team_b: string; status: string; winner: string; score_a: number | null; score_b: number | null };
const asMatch = (g: Game, i: number) => ({
  id: i, divisionId: 1, week: 1, stage: "regular", teamA: g.team_a, teamB: g.team_b, bo: 1,
  status: g.status as "final", scheduledAt: null, scoreA: g.score_a, scoreB: g.score_b, winner: g.winner,
});

before(async () => {
  lp = await import("@/lib/league-playoffs");
  admin = await import("@/lib/league-admin");
  league = await import("@/lib/league");
  lm = await import("@/lib/league-matches");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await (await import("@/lib/social")).ensureSocialSchema();
  await client.execute(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER, coins INTEGER DEFAULT 0)"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

describe("playoff and season-end rules match the bot", () => {
  it("standings (head-to-head, forfeits, a full season)", () => {
    for (const c of vectors.standings) {
      const got = league.computeStandings(c.teams, (c.matches as Game[]).map(asMatch));
      assert.deepEqual(got, c.expected);
    }
  });

  it("semi-final seeding and final places", () => {
    assert.deepEqual(lp.semiPairs(vectors.semis.standings), vectors.semis.pairs);
    const f = vectors.finalPlaces;
    assert.deepEqual(lp.finalPlaces(f.standings, f.final, f.third), f.places);
  });

  it("the draw: access, Open skill bands, merge-down and groups", () => {
    for (const d of vectors.draws) {
      const out = admin.planDivisions(d.entries, d.access);
      assert.deepEqual(
        out.map((div: { name: string; code: string; format: string; teams: { teamId: string }[] }) => ({
          name: div.name,
          code: div.code,
          format: div.format,
          teams: div.teams.map((e) => e.teamId),
        })),
        d.expected,
        d.label
      );
    }
    for (const b of vectors.openBands) assert.equal(league.openBand(b.elo), b.band, String(b.elo));
    assert.equal(league.accessLabel("main"), "Main Access");
    assert.equal(league.accessLabel(null, 1300), "Open 5-7 Access");
  });

  it("playoff weeks and best-of-3 scores", () => {
    for (const w of vectors.playoffWeeks) {
      assert.equal(lp.playoffWeek(vectors.seasonStart, w.earliest, w.now), w.week);
    }
    for (const s of vectors.scores) {
      let ok = true;
      try {
        lm.checkScores(s.a, s.b, s.bo);
      } catch {
        ok = false;
      }
      assert.equal(ok, s.ok, `${s.a}-${s.b} BO${s.bo}`);
    }
  });
});

describe("running the playoffs and ending a season from the website", () => {
  async function addTeam(t: number, seasonId?: number) {
    const ids = [String(1000 + t * 10), String(1001 + t * 10)];
    const team = {
      id: `team${t}`, name: `Team ${t}`, tag: `T${t}`, logoUrl: null, accentColor: "#ff5500", region: "EU",
      captainId: ids[0], captainName: `p${ids[0]}`,
      members: ids.map((d) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
        role: "starter", status: "accepted", joinedAt: 0 })),
      createdAt: 0, updatedAt: 0,
    };
    await client.execute({ sql: "INSERT OR REPLACE INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [team.id, JSON.stringify(team), t] });
    for (const d of ids) {
      await client.execute({
        sql: "INSERT INTO players (name, elo, placement_done, coins) SELECT ?, ?, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM players WHERE name = ?)",
        args: [`p${d}`, 2400 - t * 100, `p${d}`],
      });
    }
    if (seasonId) await league.signUpTeam(team.id, ids[0]);
  }

  async function playSeason(name: string) {
    // Invite-only: team0-3 have Advanced access, team4-7 Main access.
    for (let t = 0; t < 8; t++) {
      await addTeam(t);
      await admin.setTeamAccess(`team${t}`, t < 4 ? "advanced" : "main", STAFF);
    }
    const season = await admin.createSeason(name, STAFF);
    await admin.openSignups(season.id, 7, STAFF);
    for (let t = 0; t < 8; t++) await addTeam(t, season.id);
    await admin.closeSignups(season.id, STAFF);
    await admin.startSeason(season.id, "2099-01-05", STAFF, Date.UTC(2098, 0, 1));
    for (const m of await league.seasonMatches(season.id)) {
      const aWins = Number(m.teamA.slice(4)) < Number(m.teamB.slice(4));
      await lm.staffSetResult(m.id, { winner: aWins ? m.teamA : m.teamB, scoreA: aWins ? 13 : 5, scoreB: aWins ? 5 : 13 }, STAFF);
    }
    return season.id;
  }

  const round = async (seasonId: number, r: string) =>
    (await league.seasonMatches(seasonId)).filter((m) => m.playoffRound === r).sort((x, y) => x.divisionId! - y.divisionId!);

  it("semis → automatic final + third place → end season → next season's draw", async () => {
    for (const t of TABLES) await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
    const seasonId = await playSeason("Season 1");

    const week = await lp.startPlayoffs(seasonId, STAFF, Date.UTC(2099, 0, 5) + 40 * 86_400_000);
    assert.equal(week, 7);
    await assert.rejects(lp.startPlayoffs(seasonId, STAFF), /after the regular season/);
    const semis = [...(await round(seasonId, "semi1")), ...(await round(seasonId, "semi2"))];
    assert.deepEqual(
      semis.map((m) => [m.teamA, m.teamB, m.bo]).sort(),
      [["team0", "team3", 3], ["team1", "team2", 3], ["team4", "team7", 3], ["team5", "team6", 3]]
    );
    await assert.rejects(
      lm.staffSetResult(semis[0].id, { winner: semis[0].teamA, scoreA: 13, scoreB: 5 }, STAFF),
      /best of 3/
    );
    for (const m of semis) {
      const winner = m.teamA === "team5" ? m.teamB : m.teamA;
      await lm.staffSetResult(m.id, { winner, scoreA: winner === m.teamA ? 2 : 1, scoreB: winner === m.teamA ? 1 : 2 }, STAFF);
    }
    // The last semi result created the finals right away (no waiting for the bot).
    const finals = await round(seasonId, "final");
    const thirds = await round(seasonId, "third");
    assert.deepEqual(finals.map((m) => [m.teamA, m.teamB]), [["team0", "team1"], ["team4", "team6"]]);
    assert.deepEqual(thirds.map((m) => [m.teamA, m.teamB]), [["team3", "team2"], ["team7", "team5"]]);
    assert.deepEqual(await lp.advancePlayoffs(seasonId), [], "created once");

    await assert.rejects(lp.previewEnd(seasonId), /need results first/);
    const winners: Record<string, string> = { team0: "team1", team4: "team6", team3: "team2", team7: "team5" };
    for (const m of [...finals, ...thirds]) await lm.staffSetResult(m.id, { winner: winners[m.teamA], forfeit: true }, STAFF);

    const preview = await lp.previewEnd(seasonId);
    assert.deepEqual(preview.divisions.map((d) => d.places.slice(0, 4)), [
      ["team1", "team0", "team2", "team3"],
      ["team6", "team4", "team5", "team7"],
    ]);
    // League v2: 4-team divisions move 1 up and 1 down (same as the bot).
    assert.deepEqual(preview.divisions.map((d) => d.moves.map((m) => [m.teamId, m.direction, m.to])), [
      [["team1", "up", "pro"], ["team3", "down", "main"]],
      [["team6", "up", "advanced"], ["team7", "down", "intermediate"]],
    ]);
    await assert.rejects(lp.endSeason(seasonId, "nope", STAFF), /Type the season name/);
    await lp.endSeason(seasonId, "Season 1", STAFF);
    await assert.rejects(lp.endSeason(seasonId, "Season 1", STAFF), /after its playoffs/);

    assert.equal((await league.getSeason(seasonId))!.status, "finished");
    const titles = await client.execute("SELECT team_id, title FROM team_titles ORDER BY team_id");
    assert.deepEqual(titles.rows.map((r) => `${r.team_id}:${r.title}`), [
      "team1:Season 1 — Advanced Champions",
      "team6:Season 1 — Main Champions",
    ]);
    const coins = Object.fromEntries((await client.execute("SELECT name, coins FROM players")).rows.map((r) => [String(r.name), Number(r.coins)]));
    assert.deepEqual([coins.p1010, coins.p1011, coins.p1000, coins.p1020, coins.p1030], [5000, 5000, 2500, 1000, 0]);
    const history = await league.teamLeagueHistory("team6");
    assert.deepEqual([history[0].finalPlace, history[0].movement, history[0].prize], [1, "up", 5000]);
    const access = await league.teamAccessMap();
    assert.deepEqual(
      ["team1", "team3", "team6", "team7", "team0"].map((t) => access.get(t)),
      ["pro", "main", "advanced", "intermediate", "advanced"]
    );
    const dms = (await client.execute("SELECT message FROM discord_dm_outbox ORDER BY id")).rows.map((r) => String(r.message));
    assert.ok(dms.some((m) => m.includes("Team 1** is promoted to **Pro")));
    assert.ok(dms.some((m) => m.includes("Team 7** moves down to **Intermediate")));

    // Season 2: the moves decide the draw (tiny levels merge down, as before).
    const s2 = await admin.createSeason("Season 2", STAFF);
    await admin.openSignups(s2.id, 7, STAFF);
    for (let t = 0; t < 8; t++) await league.signUpTeam(`team${t}`, String(1000 + t * 10));
    const draw = await admin.previewDraw(s2.id);
    assert.deepEqual(draw.divisions.map((d) => [d.name, d.teams.map((t) => t.teamId).sort()]), [
      ["Pro/Advanced", ["team0", "team1", "team2", "team6"]],
      ["Main/Intermediate", ["team3", "team4", "team5", "team7"]],
    ]);

    // The team page's League section (league v2 C4): the move, and where the team plays next.
    assert.deepEqual([history[0].movedTo, history[0].teams, history[0].divisionCode], ["advanced", 4, "main"]);
    const { getTeam } = await import("@/lib/teams");
    assert.deepEqual(await league.teamLeagueStatus((await getTeam("team6"))!), {
      code: "advanced", name: "Advanced", bySkill: false, earned: true, seedElo: null,
    });
    assert.equal((await league.teamLeagueStatus((await getTeam("team2"))!)).earned, false, "staff-set, no move");
    await admin.setTeamAccess("team5", null, STAFF);
    assert.deepEqual(await league.teamLeagueStatus((await getTeam("team5"))!), {
      code: "open89", name: "Open 8-9", bySkill: true, earned: false, seedElo: 1900,
    });

    const kinds = (await admin.listEvents(seasonId)).map((e) => e.kind);
    assert.ok(kinds.includes("playoffs_started") && kinds.includes("season_finished"));
  });
});
