/**
 * The profile's data (docs/PROFILE_UI_PLAN.md §5): teammates-only "played
 * with", the season record and stat totals counted in the database (no
 * placements, no dummy matches), map totals, the longest win streak, "Load
 * more" paging, bios, and the three /api/players routes.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("profile-data");
let db: typeof import("@/lib/db");
let bios: typeof import("@/lib/player-bios");
let profileMatch: typeof import("@/lib/profile-match");

const RESET = "2026-09-01 00:00:00";
const ids: Record<string, number> = {};

type Row = {
  key: string;
  player: string;
  match: number;
  ts: string;
  result: "W" | "L";
  team?: number | null;
  map?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  hs?: number;
  mvps?: number;
  elo?: number;
  eloBefore?: number | null;
  score?: string | null;
  damage?: number | null;
  rounds?: number | null;
  mode?: string | null;
  placement?: 1 | 0;
  test?: 1 | 0;
};

async function add(r: Row) {
  const rs = await db.client.execute({
    sql: `INSERT INTO match_history (player_name, match_id, timestamp, result, team, map_name, kills, deaths,
            assists, hs_percentage, mvps, elo_change, elo_before, round_score, damage, rounds_played, mode,
            is_placement, is_test, points)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 40)`,
    args: [
      r.player, r.match, r.ts, r.result, r.team ?? null, r.map ?? "Mirage", r.kills ?? 10, r.deaths ?? 10,
      r.assists ?? 2, r.hs ?? 40, r.mvps ?? 1, r.elo ?? 0, r.eloBefore ?? null, r.score ?? null,
      r.damage ?? null, r.rounds ?? null, r.mode ?? null, r.placement ?? 0, r.test ?? 0,
    ],
  });
  if (r.player === "ana") ids[r.key] = Number(rs.lastInsertRowid);
}

before(async () => {
  db = await import("@/lib/db");
  bios = await import("@/lib/player-bios");
  profileMatch = await import("@/lib/profile-match");
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
  await db.client.execute({ sql: "INSERT INTO season_resets VALUES ('Season 1', ?)", args: [RESET] });
  await db.client.execute(`INSERT INTO players (name, elo, rank, placement_done, country, peak_elo, matches_played, matches_won) VALUES
    ('ana', 1600, '[A3 | 1450-1649]', 1, 'pt', 1600, 4, 3),
    ('bo', 1200, '[A1 | 1100-1249]', 1, 'br', 1200, 3, 2),
    ('cy', 900, '[C | 800-949]', 1, NULL, 900, 1, 1),
    ('dee', 1000, '[B | 950-1099]', 1, 'pl', 1000, 4, 1),
    ('eve', 0, '[?] Unranked', 1, NULL, 0, 1, 1),
    ('fay', 0, '[A2 | 1250-1449]', 0, NULL, 0, 1, 1)`);

  // Placements (June): counts for "member since" and played-with, not for stats.
  await add({ key: "p1", player: "ana", match: 900, ts: "2026-06-14 18:00:00", result: "W", team: 1, placement: 1 });
  await add({ key: "", player: "bo", match: 900, ts: "2026-06-14 18:00:00", result: "W", team: 1 });
  // Last season.
  await add({ key: "m1", player: "ana", match: 1, ts: "2026-08-20 18:00:00", result: "W", team: 1, kills: 15, deaths: 15, assists: 1, score: "13,11", elo: 19 });
  await add({ key: "", player: "bo", match: 1, ts: "2026-08-20 18:00:00", result: "W", team: 1 });
  await add({ key: "", player: "dee", match: 1, ts: "2026-08-20 18:00:00", result: "L", team: 2 });
  // This season.
  await add({ key: "m2", player: "ana", match: 2, ts: "2026-09-10 18:00:00", result: "L", team: 2, kills: 10, deaths: 15, score: "13,9", damage: 1500, elo: -18, hs: 40, mvps: 0 });
  await add({ key: "", player: "bo", match: 2, ts: "2026-09-10 18:00:00", result: "L", team: 2 });
  await add({ key: "", player: "dee", match: 2, ts: "2026-09-10 18:00:00", result: "W", team: 1 });
  // A legacy row: no team, no scoreline.
  await add({ key: "m3", player: "ana", match: 3, ts: "2026-09-11 18:00:00", result: "W", team: null, kills: 20, deaths: 10, assists: 5, damage: 2000, elo: 22, hs: 50, mvps: 2 });
  await add({ key: "", player: "cy", match: 3, ts: "2026-09-11 18:00:00", result: "W", team: null });
  await add({ key: "", player: "dee", match: 3, ts: "2026-09-11 18:00:00", result: "L", team: null });
  // A /rank testdummies match: invisible everywhere.
  await add({ key: "m4", player: "ana", match: 4, ts: "2026-09-12 18:00:00", result: "W", team: 1, test: 1, map: "Nuke" });
  await add({ key: "", player: "eve", match: 4, ts: "2026-09-12 18:00:00", result: "W", team: 1, test: 1 });
  // Counter Blox's own round count (24) beats the scoreline (13:7).
  await add({ key: "m5", player: "ana", match: 5, ts: "2026-09-13 18:00:00", result: "W", team: 1, map: "Inferno", kills: 25, deaths: 12, assists: 3, score: "13,7", rounds: 24, damage: 2400, elo: 20, eloBefore: 1580, hs: 60, mvps: 4, mode: "5v5" });
  await add({ key: "", player: "fay", match: 5, ts: "2026-09-13 18:00:00", result: "W", team: 1 });
  await add({ key: "", player: "dee", match: 5, ts: "2026-09-13 18:00:00", result: "L", team: 2 });
});

after(async () => {
  await tmp.cleanup(["match_history", "players", "season_resets", "player_bios", "player_bans"]);
});

describe("getMostPlayedWith", () => {
  it("counts teammates only — never opponents or dummy matches — with wins together", async () => {
    const rows = await db.getMostPlayedWith("ana");
    assert.deepEqual(
      rows.map((r) => [r.name, r.count, r.wins]),
      [
        ["bo", 3, 2], // m1 W, m2 L, the placement W
        ["cy", 1, 1], // legacy row: same result
        ["fay", 1, 1],
      ]
    );
  });

  it("carries the public rank and country", async () => {
    const rows = await db.getMostPlayedWith("ana");
    const bo = rows.find((r) => r.name === "bo")!;
    assert.equal(bo.rank, "A1");
    assert.equal(bo.country, "br");
    assert.equal(rows.find((r) => r.name === "fay")!.rank, "UNRANKED"); // mid-placement
  });
});

describe("getProfileSummary", () => {
  it("first and last match of any kind; this season's ranked record", async () => {
    assert.deepEqual(await db.getProfileSummary("ana", RESET), {
      firstMatchAt: "2026-06-14 18:00:00",
      lastMatchAt: "2026-09-13 18:00:00",
      seasonMatches: 3,
      seasonWins: 2,
    });
  });

  it("is empty for someone with no matches", async () => {
    const s = await db.getProfileSummary("nobody", RESET);
    assert.equal(s.firstMatchAt, null);
    assert.equal(s.seasonMatches, 0);
  });
});

describe("getMatchTimestamps", () => {
  it("every real match since the date, newest first", async () => {
    assert.deepEqual(await db.getMatchTimestamps("ana", "2026-09-01 00:00:00"), [
      "2026-09-13 18:00:00",
      "2026-09-11 18:00:00",
      "2026-09-10 18:00:00",
    ]);
  });
});

describe("getStatTotals", () => {
  it("this season: K/R and ADR only over matches with a round count", async () => {
    const t = await db.getStatTotals("ana", RESET);
    assert.equal(t.matches, 3);
    assert.equal(t.wins, 2);
    assert.equal(t.kills, 55);
    assert.equal(t.deaths, 37);
    assert.equal(t.rounds, 46); // 13+9, and 24 (not 13+7) for the cbrm game
    assert.equal(t.roundKills, 35); // m3 has no scoreline
    assert.equal(t.damage, 3900);
    assert.equal(t.damageRounds, 46);
    assert.equal(t.absElo, 60);
    assert.equal(t.elo, 24);
    assert.equal(t.hsPercent, 50);
  });

  it("career adds last season, still without placements or dummies", async () => {
    const t = await db.getStatTotals("ana", null);
    assert.equal(t.matches, 4);
    assert.equal(t.wins, 3);
    assert.equal(t.rounds, 70);
    assert.equal(t.damage, 3900); // m1 has no damage
  });
});

describe("getMapTotals", () => {
  it("per map, most played first", async () => {
    const maps = await db.getMapTotals("ana", RESET);
    assert.deepEqual(
      maps.map((m) => [m.map, m.matches, m.wins]),
      [
        ["Mirage", 2, 1],
        ["Inferno", 1, 1],
      ]
    );
  });
});

describe("getLongestWinStreak", () => {
  it("counts ranked wins in a row", async () => {
    assert.equal(await db.getLongestWinStreak("ana", RESET), 2); // L, W, W
    assert.equal(await db.getLongestWinStreak("ana", null), 2); // W, L, W, W
    assert.equal(await db.getLongestWinStreak("nobody", null), 0);
  });
});

describe("getMatchesForPlayer paging", () => {
  it("pages older matches with beforeId", async () => {
    const first = await db.getMatchesForPlayer("ana", 2);
    assert.deepEqual(first.map((m) => m.match_id), [5, 3]);
    const next = await db.getMatchesForPlayer("ana", 2, Number(first[1].id));
    assert.deepEqual(next.map((m) => m.match_id), [2, 1]);
  });

  it("returns the damage, rounds and mode columns", async () => {
    const [m5] = await db.getMatchesForPlayer("ana", 1);
    assert.equal(m5.damage, 2400);
    assert.equal(m5.rounds_played, 24);
    assert.equal(m5.mode, "5v5");
  });
});

describe("toProfileMatch", () => {
  it("Elo after, rank from it when the row has none, rounds and mode", async () => {
    const [m5, m3] = await db.getMatchesForPlayer("ana", 2);
    const a = profileMatch.toProfileMatch(m5, "[A3 | 1450-1649]");
    assert.equal(a.elo, 1580);
    assert.equal(a.eloAfter, 1600);
    assert.equal(a.rank, "A3");
    assert.equal(a.roundsPlayed, 24);
    assert.equal(a.gameMode, "5v5");
    assert.equal(a.rowId, ids.m5);
    const b = profileMatch.toProfileMatch(m3, "[A3 | 1450-1649]");
    assert.equal(b.eloAfter, undefined);
    assert.equal(b.roundsPlayed, null);
    assert.equal(b.rank, "A3"); // legacy row: the player's current rank
  });
});

describe("bios", () => {
  it("normalizes what people type", () => {
    assert.equal(bios.normalizeBio("  Entry   for NOVA.\r\n\r\n\r\nMirage\u0007 enjoyer  "), "Entry for NOVA.\n\nMirage enjoyer");
  });

  it("refuses long or rude ones", () => {
    assert.equal(bios.bioError("ok"), null);
    assert.match(bios.bioError("x".repeat(bios.BIO_MAX_LENGTH + 1))!, /160/);
    assert.match(bios.bioError("what the fuck")!, /isn't allowed/);
  });

  it("saves, replaces and clears", async () => {
    const id = Number((await db.client.execute("SELECT id FROM players WHERE name = 'ana'")).rows[0].id);
    assert.equal(await bios.getBio(id), null);
    await bios.setBio(id, "Mirage enjoyer");
    await bios.setBio(id, "Entry for NOVA");
    assert.equal(await bios.getBio(id), "Entry for NOVA");
    await bios.setBio(id, "");
    assert.equal(await bios.getBio(id), null);
    await bios.setBio(id, "Entry for NOVA");
  });
});

describe("/api/players routes", () => {
  const params = (name: string) => ({ params: Promise.resolve({ name }) });

  it("GET /api/players/[name] has the season record, prestige, times and teammates", async () => {
    const { GET } = await import("@/app/api/players/[name]/route");
    const res = await GET(new Request("http://localhost/api/players/ana"), params("ana"));
    assert.equal(res.status, 200);
    const p = await res.json();
    assert.equal(p.username, "ana");
    assert.deepEqual(p.season, { number: 2, label: "Season 2", startedAt: RESET });
    assert.equal(p.seasonMatchesPlayed, 3);
    assert.equal(p.seasonWins, 2);
    assert.equal(Math.round(p.seasonWinPercent), 67);
    assert.equal(p.prestige.level, 0);
    assert.equal(p.prestige.winsIntoLevel, 2);
    assert.equal(p.firstMatchAt, "2026-06-14 18:00:00");
    assert.equal(p.lastMatchAt, "2026-09-13 18:00:00");
    assert.equal(p.bio, "Entry for NOVA");
    assert.deepEqual(p.playedWith.map((x: { name: string }) => x.name), ["bo", "cy", "fay"]);
    assert.equal(p.eloTimes.length, p.eloHistory.length);
    assert.equal(p.matchHistory[0].eloAfter, 1600);
    assert.equal(p.hasMoreMatches, false);
    assert.deepEqual(p.teams, []);
    assert.equal(p.ban, null, "no player_bans table yet");
  });

  it("GET …/stats sums the scope in the database", async () => {
    const { GET } = await import("@/app/api/players/[name]/stats/route");
    const season = await (await GET(new Request("http://localhost/api/players/ana/stats"), params("ana"))).json();
    assert.equal(season.scope, "season");
    assert.equal(season.totals.matches, 3);
    assert.equal(season.totals.kr, 35 / 46);
    assert.equal(season.totals.adr, Math.round((3900 / 46) * 10) / 10);
    assert.equal(season.longestWinStreak, 2);
    assert.deepEqual(season.maps.map((m: { map: string }) => m.map), ["Mirage", "Inferno"]);
    const career = await (
      await GET(new Request("http://localhost/api/players/ana/stats?scope=career"), params("ana"))
    ).json();
    assert.equal(career.scope, "career");
    assert.equal(career.totals.matches, 4);
  });

  it("GET …/matches pages with ?before=", async () => {
    const { GET } = await import("@/app/api/players/[name]/matches/route");
    const res = await GET(new Request(`http://localhost/api/players/ana/matches?before=${ids.m3}&limit=1`), params("ana"));
    const data = await res.json();
    assert.deepEqual(data.matches.map((m: { matchId: number }) => m.matchId), [2]);
    assert.equal(data.hasMore, true);
  });

  it("marks an active /player ban on the profile, the leaderboard and search — not a lifted one", async () => {
    await db.client.execute("UPDATE players SET discord_id = '301' WHERE name = 'ana'");
    await db.client.execute("UPDATE players SET discord_id = '302' WHERE name = 'bo'");
    await db.client.execute(`CREATE TABLE player_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT NOT NULL, roblox_user_id INTEGER,
      player_name TEXT, reason TEXT NOT NULL, banned_by TEXT NOT NULL, banned_at TEXT NOT NULL,
      lifted_at TEXT, lifted_by TEXT)`);
    await db.client.execute(`INSERT INTO player_bans (discord_id, reason, banned_by, banned_at, lifted_at) VALUES
      ('301', 'cheating', 'staff', '2026-10-03 18:00:00', NULL),
      ('302', 'old one', 'staff', '2026-09-01 00:00:00', '2026-09-02 00:00:00')`);
    (await import("@/lib/server-cache")).forget("bans:shown");

    const profile = (await import("@/app/api/players/[name]/route")).GET;
    const ana = await (await profile(new Request("http://localhost/api/players/ana"), params("ana"))).json();
    assert.deepEqual(ana.ban, { since: "2026-10-03T18:00:00.000Z" });
    assert.equal(JSON.stringify(ana).includes("cheating"), false, "the reason stays staff-only");
    const bo = await (await profile(new Request("http://localhost/api/players/bo"), params("bo"))).json();
    assert.equal(bo.ban, null);

    const { GET } = await import("@/app/api/players/route");
    const board: { username: string; banned: boolean }[] = await (await GET(new Request("http://localhost/api/players"))).json();
    assert.deepEqual(board.filter((p) => p.banned).map((p) => p.username), ["ana"]);
    const found: { username: string; banned: boolean }[] = await (await GET(new Request("http://localhost/api/players?q=an"))).json();
    assert.deepEqual(found.map((p) => [p.username, p.banned]), [["ana", true]]);
  });

  it("404s for an unknown player", async () => {
    const { GET } = await import("@/app/api/players/[name]/stats/route");
    const res = await GET(new Request("http://localhost/api/players/nobody/stats"), params("nobody"));
    assert.equal(res.status, 404);
  });
});
