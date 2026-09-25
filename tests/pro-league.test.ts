/**
 * Pro ladder from league matches (docs/LEAGUE_V2_PLAN.md, Part A), website side:
 * the division weights equal the bot's (core/pro_league.py), the match page gets
 * each player's Pro Elo change, and the Pro queue is switched off.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("pro-league");
let pro: typeof import("@/lib/pro-league");
let stats: typeof import("@/lib/league-stats");
let league: typeof import("@/lib/league");
let modes: typeof import("@/lib/queue-modes");
let client: typeof import("@/lib/db").client;

const BOT_FILE = join(__dirname, "..", "..", "..", "core", "pro_league.py");

before(async () => {
  pro = await import("@/lib/pro-league");
  stats = await import("@/lib/league-stats");
  league = await import("@/lib/league");
  modes = await import("@/lib/queue-modes");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
});

after(async () => {
  await tmp.cleanup(["league_pro_elo", "league_matches", "league_divisions", "web_teams"]);
});

describe("Pro ladder weights", () => {
  it("match the bot's DIVISION_WEIGHTS", { skip: !existsSync(BOT_FILE) && "bot checkout not next to the website" }, () => {
    const src = readFileSync(BOT_FILE, "utf-8");
    const block = /DIVISION_WEIGHTS[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? "";
    const bot = Object.fromEntries([...block.matchAll(/"(\w+)":\s*([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    assert.deepEqual(bot, pro.PRO_DIVISION_WEIGHTS);
  });

  it("merged and lower divisions", () => {
    assert.equal(pro.proDivisionWeight("main"), 1.3);
    assert.equal(pro.proDivisionWeight("pro+advanced"), 1.4);
    assert.equal(pro.proDivisionWeight("open10+open89"), 1.0);
    assert.equal(pro.proDivisionWeight("open89"), null);
    assert.equal(pro.proDivisionWeight("open57+open14"), null);
    assert.equal(pro.proDivisionWeight(null), null);
  });

  it("the Pro queue is switched off; old Pro games are labelled", () => {
    assert.equal(modes.PRO_QUEUE_ENABLED, false);
    assert.equal(modes.queueModeLabel("pro"), "Pro Matchmaking (old)");
  });
});

describe("matchProElo", () => {
  it("returns the weight and each player's change, or nothing below Open10", async () => {
    await client.execute("INSERT INTO league_divisions (id, season_id, name, tier, code) VALUES (1, 1, 'Main', 3, 'main')");
    await client.execute("INSERT INTO league_divisions (id, season_id, name, tier, code) VALUES (2, 1, 'Open 8-9', 7, 'open89')");
    for (const [name, team, b, a] of [["x", "A", 0, 25], ["y", "A", 10, 30], ["z", "B", 5, 0]] as const) {
      await client.execute({
        sql: "INSERT INTO league_pro_elo (match_id, season_id, player_name, team_id, elo_before, elo_after, weight) VALUES (7, 1, ?, ?, ?, ?, 1.3)",
        args: [name, team, b, a],
      });
    }
    const got = await stats.matchProElo(7, 1);
    assert.equal(got.weight, 1.3);
    assert.deepEqual(got.deltas.map((d) => [d.playerName, d.after - d.before]), [["x", 25], ["y", 20], ["z", -5]]);
    assert.deepEqual(await stats.matchProElo(7, 2), { weight: null, deltas: [] });
    assert.deepEqual(await stats.matchProElo(8, 1), { weight: 1.3, deltas: [] }, "not rebuilt yet");
  });
});

describe("Pro leaderboard details (league v2 C6)", () => {
  it("counts each player's league matches and keeps the latest one's change, division and team", async () => {
    const ladder = await import("@/lib/pro-ladder");
    const row = (player: string, matchId: number, week: number, before: number, after: number, division: string) => ({
      player, matchId, seasonId: 1, week, teamId: "A", before, after, division, code: "main",
    });
    const got = ladder.summarizeProRows([row("Ana", 9, 2, 40, 31, "Main"), row("ana", 4, 1, 0, 40, "Main"), row("Bo", 4, 1, 0, 12, "Main")]);
    assert.deepEqual(got.get("ana"), { matches: 2, lastDelta: -9, division: "Main", code: "main", teamId: "A", seasonId: 1 });
    assert.equal(got.get("bo")?.matches, 1);

    // From the table (match 7 above has no league_matches row: week 0, no division).
    await client.execute(
      "INSERT INTO league_matches (id, season_id, division_id, week, stage, team_a, team_b, bo, status, updated_at) VALUES (7, 1, 1, 3, 'regular', 'A', 'B', 1, 'final', 0)"
    );
    const info = await ladder.proLeagueInfo();
    assert.deepEqual([info.get("x")?.matches, info.get("x")?.division, info.get("z")?.lastDelta], [1, "Main", -5]);
  });
});
