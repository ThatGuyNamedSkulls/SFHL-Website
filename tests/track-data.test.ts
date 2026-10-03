/**
 * The Track page's data (docs/TRACK_UI_PLAN.md §5): ranked matches with the
 * map / mode filters, the filter options, the range splits (the period
 * before, last season), the tier benchmark (Q2) with the rating in SQL equal
 * to performanceRating(), and GET /api/players/[name]/track.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("track-data");
let db: typeof import("@/lib/db");
let track: typeof import("@/lib/track");
let stats: typeof import("@/lib/match-stats");

const PREV_RESET = "2026-06-01 00:00:00";
const RESET = "2026-09-01 00:00:00";
const A3 = "[A3 | 1450-1649]";
/** ana's i-th match this season: one a day from 2 Sep, 18:00 UTC. */
const day = (i: number) => new Date(Date.UTC(2026, 8, 2 + i, 18)).toISOString().slice(0, 19).replace("T", " ");

type Row = {
  player: string;
  match: number;
  ts: string;
  result: "W" | "L";
  map?: string;
  mode?: string | null;
  kills?: number;
  deaths?: number;
  assists?: number;
  mvps?: number;
  points?: number;
  score?: string | null;
  rounds?: number | null;
  damage?: number | null;
  elo?: number;
  eloBefore?: number | null;
  fk?: number | null;
  placement?: 1 | 0;
  test?: 1 | 0;
};

const rows: Row[] = [];
function add(r: Row) {
  rows.push(r);
}

before(async () => {
  db = await import("@/lib/db");
  track = await import("@/lib/track");
  stats = await import("@/lib/match-stats");
  await db.client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT DEFAULT '[?] Unranked',
    country TEXT, total_kills INTEGER DEFAULT 0, total_deaths INTEGER DEFAULT 0, total_assists INTEGER DEFAULT 0,
    kd_ratio REAL DEFAULT 0, total_mvps INTEGER DEFAULT 0, total_score INTEGER DEFAULT 0,
    total_headshot_percentage REAL DEFAULT 0, avg_hs_percent REAL DEFAULT 0, matches_played INTEGER DEFAULT 0,
    matches_won INTEGER DEFAULT 0, peak_elo INTEGER DEFAULT 0, total_play_time INTEGER DEFAULT 0,
    roblox_avatar_image TEXT, placement_done INTEGER DEFAULT 0, placement_games_played INTEGER DEFAULT 0,
    discord_id TEXT, discord_username TEXT, discord_avatar TEXT, mm_access INTEGER DEFAULT 0)`);
  await db.client.execute(`CREATE TABLE match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, player_name TEXT, map_name TEXT, region TEXT,
    kills INTEGER, deaths INTEGER, assists INTEGER, hs_percentage REAL, elo_change INTEGER, result TEXT,
    points INTEGER, executed_by TEXT, timestamp TEXT, mvps INTEGER, match_id INTEGER, round_score TEXT,
    is_placement INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0, team INTEGER, mode TEXT, is_sub INTEGER,
    left_early INTEGER, sub_share REAL, player_rank TEXT, elo_before INTEGER, win_chance REAL,
    skill_before INTEGER, damage INTEGER, first_kills INTEGER, rounds_2k INTEGER, rounds_3k INTEGER,
    rounds_4k INTEGER, rounds_5k INTEGER, rounds_played INTEGER)`);
  await db.client.execute("CREATE TABLE season_resets (season_name TEXT, reset_at TEXT)");
  await db.client.execute({ sql: "INSERT INTO season_resets VALUES ('Season 1', ?), ('Season 2', ?)", args: [PREV_RESET, RESET] });
  await db.client.execute({
    sql: `INSERT INTO players (name, elo, rank, placement_done, peak_elo, placement_games_played) VALUES
      ('ana', 1580, ?, 1, 1600, 3), ('bo', 1500, ?, 1, 1500, 3), ('cy', 1460, ?, 1, 1460, 3),
      ('dan', 0, ?, 0, 0, 1), ('eli', 1200, '[A1 | 1100-1249]', 1, 1200, 3), ('fay', 0, '[?] Unranked', 0, 0, 2)`,
    args: [A3, A3, A3, A3],
  });

  // ana: five matches last season (rows go in in time order, like the bot's ids) …
  for (let i = 0; i < 5; i++) {
    add({ player: "ana", match: 50 + i, ts: `2026-07-1${i} 18:00:00`, result: "W", map: "Mirage", mode: "5v5", elo: 20 });
  }
  // … 30 ranked matches this season, W/L alternating from 1580 (peak 1600 after the first).
  const maps = ["de_mirage", "Mirage", "Inferno"];
  for (let i = 0; i < 30; i++) {
    const win = i % 2 === 0;
    add({
      player: "ana", match: 100 + i, ts: day(i), result: win ? "W" : "L", map: maps[i % 3], mode: i % 5 === 0 ? "2v2" : "5v5",
      kills: 10 + (i % 7), deaths: 8 + (i % 5), assists: i % 4, mvps: i % 3, points: 30 + i, score: win ? "13,9" : "9,13",
      rounds: i % 4 === 0 ? 20 + (i % 3) : null, damage: i % 6 === 0 ? null : 1500 + 10 * i,
      elo: win ? 20 : -20, eloBefore: win ? 1580 : 1600, fk: i % 3 === 0 ? 2 : null,
    });
  }
  // A placement game and a dummy match: never ranked.
  add({ player: "ana", match: 300, ts: day(30), result: "W", map: "Mirage", placement: 1 });
  add({ player: "ana", match: 301, ts: day(31), result: "W", map: "Nuke", test: 1 });

  // A3 peers (placed) this season; dan is A3 by label but hasn't placed; eli is A1.
  for (let i = 0; i < 30; i++) {
    add({ player: "bo", match: 400 + i, ts: day(i), result: i % 3 ? "W" : "L", map: "Mirage", kills: 15, deaths: 12, elo: i % 3 ? 18 : -22, rounds: 22, damage: 1800 });
    add({ player: "cy", match: 500 + i, ts: day(i), result: i % 4 ? "L" : "W", map: "Mirage", kills: 9, deaths: 14, elo: i % 4 ? -19 : 21, score: "10,13" });
  }
  for (let i = 0; i < 10; i++) add({ player: "dan", match: 600 + i, ts: day(i), result: "W", kills: 40, deaths: 1 });
  for (let i = 0; i < 10; i++) add({ player: "eli", match: 700 + i, ts: day(i), result: "W", kills: 40, deaths: 1 });
  // fay: two placement games this season.
  add({ player: "fay", match: 800, ts: day(1), result: "W", placement: 1 });
  add({ player: "fay", match: 801, ts: day(2), result: "L", placement: 1 });

  await db.client.batch(
    rows.map((r) => ({
      sql: `INSERT INTO match_history (player_name, match_id, timestamp, result, map_name, mode, kills, deaths, assists,
              hs_percentage, mvps, points, round_score, rounds_played, damage, elo_change, elo_before, first_kills,
              is_placement, is_test)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 40, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.player, r.match, r.ts, r.result, r.map ?? "Mirage", r.mode ?? null, r.kills ?? 10, r.deaths ?? 10, r.assists ?? 2,
        r.mvps ?? 1, r.points ?? 40, r.score ?? null, r.rounds ?? null, r.damage ?? null, r.elo ?? 0, r.eloBefore ?? null,
        r.fk ?? null, r.placement ?? 0, r.test ?? 0,
      ],
    })),
    "write"
  );
});

after(async () => {
  await tmp.cleanup(["match_history", "players", "season_resets"]);
});

describe("getPlayerMatches", () => {
  it("ranked rows only (no placement, no dummies), newest first", async () => {
    const list = await track.getPlayerMatches("ana", { limit: 100 });
    assert.equal(list.length, 35);
    assert.equal(list[0].timestamp, day(29));
    assert.ok(!list.some((m) => m.match_id === 300 || m.match_id === 301)); // the placement and the dummy
  });

  it("filters by time, by every spelling of a map and by mode", async () => {
    assert.equal((await track.getPlayerMatches("ana", { limit: 100, since: RESET })).length, 30);
    assert.equal((await track.getPlayerMatches("ana", { limit: 100, since: PREV_RESET, until: RESET })).length, 5);
    const mirage = await track.getPlayerMatches("ana", { limit: 100, since: RESET, maps: ["de_mirage", "Mirage"] });
    assert.equal(mirage.length, 20);
    assert.equal((await track.getPlayerMatches("ana", { limit: 100, since: RESET, mode: "2v2" })).length, 6);
  });

  it("carries Counter Blox's first kills", async () => {
    const [m] = await track.getPlayerMatches("ana", { limit: 1, since: RESET, maps: ["de_mirage"] });
    assert.equal(m.first_kills, 2);
  });
});

describe("getTrackOptions", () => {
  it("one entry per shown map name with its stored spellings, and the modes", async () => {
    assert.deepEqual(await track.getTrackOptions("ana"), {
      maps: [
        { value: "Inferno", label: "Inferno" },
        { value: "Mirage|de_mirage", label: "Mirage" },
      ],
      modes: ["2v2", "5v5"],
    });
  });
});

describe("trackWindows", () => {
  const resets = [PREV_RESET, RESET];

  it("last 20: the newest 20 and the 20 before (here 15)", async () => {
    const w = await track.trackWindows("ana", "last20", {}, resets);
    assert.equal(w.current.length, 20);
    assert.equal(w.previous?.length, 15);
    assert.equal(w.compare, "the 20 matches before");
    assert.equal(w.truncated, false);
  });

  it("7 days: split by date, the 7 days before as the comparison", async () => {
    const now = Date.UTC(2026, 9, 2, 0, 0); // 2 Oct 00:00 UTC; the last match was 1 Oct
    const w = await track.trackWindows("ana", "7d", {}, resets, now);
    assert.deepEqual(w.current.map((m) => m.timestamp), [29, 28, 27, 26, 25, 24, 23].map(day));
    assert.deepEqual(w.previous?.map((m) => m.timestamp), [22, 21, 20, 19, 18, 17, 16].map(day));
  });

  it("this season against last season, with the filters", async () => {
    const w = await track.trackWindows("ana", "season", { maps: ["Mirage", "de_mirage"] }, resets);
    assert.equal(w.current.length, 20);
    assert.equal(w.previous?.length, 5);
    assert.equal(w.compare, "last season");
  });

  it("career has nothing to compare with", async () => {
    const w = await track.trackWindows("ana", "career", {}, resets);
    assert.equal(w.current.length, 35);
    assert.equal(w.previous, null);
    assert.equal(w.compare, null);
  });
});

describe("tier benchmark", () => {
  it("RATING_SQL is performanceRating() row by row", async () => {
    const rs = await db.client.execute(
      `SELECT kills, deaths, assists, mvps, points, rr, ${track.RATING_SQL} AS r
       FROM (SELECT *, ${db.ROUNDS_SQL} AS rr FROM match_history)`
    );
    assert.ok(rs.rows.length > 100);
    let roundsBranch = 0;
    for (const row of rs.rows) {
      const js = stats.performanceRating({
        kills: Number(row.kills),
        deaths: Number(row.deaths),
        assists: Number(row.assists),
        mvps: Number(row.mvps),
        score: Number(row.points),
        rounds: row.rr == null ? null : Number(row.rr),
      });
      if (row.rr != null) roundsBranch++;
      // Both round to 2 decimals; half-way cases may round apart by one step.
      assert.ok(Math.abs(js - Number(row.r)) <= 0.0100001, `${js} vs ${row.r}`);
    }
    assert.ok(roundsBranch > 0 && roundsBranch < rs.rows.length); // both formulas covered
  });

  it("averages this season's ranked matches of placed players in the tier", async () => {
    const b = await track.getTierBenchmark(A3, RESET);
    assert.ok(b);
    assert.equal(b.matches, 90); // ana 30 + bo 30 + cy 30; not dan, eli, last season, placements or dummies
    const tier = rows.filter((r) => ["ana", "bo", "cy"].includes(r.player) && r.ts >= RESET && !r.placement && !r.test);
    assert.equal(tier.length, 90);
    const wins = tier.filter((r) => r.result === "W").length;
    assert.equal(b.winPercent, (wins / 90) * 100);
    const kills = tier.reduce((s, r) => s + (r.kills ?? 10), 0);
    const deaths = tier.reduce((s, r) => s + (r.deaths ?? 10), 0);
    assert.equal(b.kd, kills / deaths);
    assert.equal(b.eloPerMatch, tier.reduce((s, r) => s + (r.elo ?? 0), 0) / 90);
    assert.equal(b.firstKillsPerMatch, 2); // only ana's scoreboard games have first kills
    const roundsOf = (r: Row) =>
      r.rounds ?? (r.score ? r.score.split(",").reduce((s, n) => s + Number(n), 0) : null);
    const jsRating =
      tier.reduce(
        (s, r) =>
          s +
          stats.performanceRating({
            kills: r.kills ?? 10,
            deaths: r.deaths ?? 10,
            assists: r.assists ?? 2,
            mvps: r.mvps ?? 1,
            score: r.points ?? 40,
            rounds: roundsOf(r),
          }),
        0
      ) / 90;
    assert.ok(Math.abs(b.rating - jsRating) < 0.005, `${b.rating} vs ${jsRating}`);
  });

  it("is hidden below 50 matches (a map filter here)", async () => {
    assert.equal(await track.getTierBenchmark(A3, RESET, ["Inferno"]), null);
    assert.equal(await track.getTierBenchmark("[A1 | 1100-1249]", RESET), null);
  });
});

describe("GET /api/players/[name]/track", () => {
  const params = (name: string) => ({ params: Promise.resolve({ name }) });
  const get = async (path: string, name: string) => {
    const { GET } = await import("@/app/api/players/[name]/track/route");
    return GET(new Request(`http://localhost/api/players/${path}`), params(name));
  };

  it("defaults to the last 20 matches, with the 20 before, the options and the tier", async () => {
    const res = await get("ana/track", "ana");
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.range, "last20");
    assert.equal(d.matches.length, 20);
    assert.equal(d.previous.length, 15);
    assert.equal(d.compare, "the 20 matches before");
    assert.equal(d.recent.length, 35);
    assert.equal(d.benchmark.rank, A3);
    assert.equal(d.player.rank, "A3");
    assert.equal(d.player.peakElo, 1600);
    assert.equal(d.player.peakAt, day(0)); // the first match this season that ended on 1600
    assert.equal(d.player.prestige.wins, 15);
    assert.deepEqual(d.player.season, { number: 3, label: "Season 3", startedAt: RESET });
    assert.equal(d.matches[0].firstKills, null);
    assert.deepEqual(d.filters, { map: null, mode: null });
  });

  it("takes a range, a map (all its spellings) and a mode; ignores unknown values", async () => {
    const career = await (await get("ana/track?range=career", "ana")).json();
    assert.equal(career.matches.length, 35);
    assert.equal(career.previous, null);
    const mirage = await (await get("ana/track?range=season&map=Mirage%7Cde_mirage&mode=5v5", "ana")).json();
    assert.deepEqual(mirage.filters, { map: "Mirage|de_mirage", mode: "5v5" });
    assert.equal(mirage.matches.length, 16); // 20 Mirage games, 4 of them 2v2
    const junk = await (await get("ana/track?range=forever&map=Atlantis&mode=9v9", "ana")).json();
    assert.equal(junk.range, "last20");
    assert.deepEqual(junk.filters, { map: null, mode: null });
    assert.equal(junk.matches.length, 20);
  });

  it("mid-placement: this season's placement games, no tier averages", async () => {
    const d = await (await get("fay/track", "fay")).json();
    assert.equal(d.player.placementDone, false);
    assert.equal(d.player.placementGamesPlayed, 2);
    assert.equal(d.matches.length, 0);
    assert.equal(d.placementMatches.length, 2);
    assert.equal(d.benchmark, null);
    assert.equal(d.player.peakAt, null);
  });

  it("404s for an unknown player", async () => {
    assert.equal((await get("nobody/track", "nobody")).status, 404);
  });
});
