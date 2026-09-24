/**
 * Team League match actions on the website (phase 3): the same rules as the
 * bot's core/league_matches.py — scheduling, results, forfeits — plus the DMs
 * they queue for the bot to deliver.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("league-matches");
let lm: typeof import("@/lib/league-matches");
let league: typeof import("@/lib/league");
let client: typeof import("@/lib/db").client;

const TABLES = ["league_matches", "league_entries", "league_divisions", "league_seasons", "web_teams", "discord_dm_outbox"];
const MONDAY = Date.UTC(2099, 0, 5);
const H = 3_600_000;
const D = 24 * H;
const CAP_A = "100";
const CAP_B = "200";
let matchId = 0;

async function seed() {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
  const season = await client.execute({
    sql: `INSERT INTO league_seasons (name, status, start_date, weeks, created_at, updated_at)
          VALUES ('Season 1', 'regular', ?, 6, 0, 0)`,
    args: [MONDAY],
  });
  const seasonId = Number(season.lastInsertRowid);
  for (const [id, cap] of [["aaa", CAP_A], ["bbb", CAP_B]] as const) {
    const ids = [cap, `${cap}1`, `${cap}2`];
    const team = {
      id, name: `Team ${id}`, tag: id.toUpperCase(), logoUrl: null, accentColor: "#ff5500", region: "EU",
      captainId: cap, captainName: cap,
      members: ids.map((d) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
        role: "starter", status: "accepted", joinedAt: 0 })),
      createdAt: 0, updatedAt: 0,
    };
    await client.execute({
      sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)",
      args: [id, JSON.stringify(team), 0],
    });
    await client.execute({
      sql: `INSERT INTO league_entries (season_id, team_id, team_name, team_tag, captain_id, roster, status, signed_up_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', 0)`,
      args: [seasonId, id, team.name, team.tag, cap,
        JSON.stringify(ids.map((d) => ({ discordId: d, playerName: `p${d}`, username: `u${d}`, role: "starter" })))],
    });
  }
  const m = await client.execute({
    sql: "INSERT INTO league_matches (season_id, week, team_a, team_b, bo, status) VALUES (?, 1, 'aaa', 'bbb', 1, 'unscheduled')",
    args: [seasonId],
  });
  matchId = Number(m.lastInsertRowid);
}

async function dms() {
  const rs = await client.execute("SELECT discord_id, message FROM discord_dm_outbox ORDER BY id");
  return rs.rows.map((r) => [String(r.discord_id), String(r.message)] as const);
}

before(async () => {
  lm = await import("@/lib/league-matches");
  league = await import("@/lib/league");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await (await import("@/lib/social")).ensureSocialSchema();
});

beforeEach(seed);

after(async () => {
  await tmp.cleanup(TABLES);
});

describe("league match scheduling", () => {
  it("proposes inside the match week, accepts from the other captain and DMs", async () => {
    const now = MONDAY - 2 * D;
    const wed = MONDAY + 2 * D + 19 * H;
    await assert.rejects(lm.proposeTime(matchId, "999", wed, now), /Only the two team captains/);
    await assert.rejects(lm.proposeTime(matchId, CAP_A, MONDAY + 8 * D, now), /inside the match week/);
    await lm.proposeTime(matchId, CAP_A, wed, now);
    assert.equal((await dms())[0][0], CAP_B, "the other captain is told");
    await assert.rejects(lm.acceptTime(matchId, CAP_A, now), /other captain has to accept/);
    await lm.acceptTime(matchId, CAP_B, now);
    const m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.scheduledAt, m.proposedTime], ["scheduled", wed, null]);
    assert.equal((await dms()).filter(([, msg]) => msg.includes("is scheduled")).length, 6, "both rosters");

    // A declined move keeps the agreed time.
    await lm.proposeTime(matchId, CAP_B, wed + H, now);
    await lm.declineTime(matchId, CAP_A);
    const back = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([back.status, back.scheduledAt], ["scheduled", wed]);
  });
});

describe("league match results", () => {
  async function schedule(start: number) {
    await client.execute({
      sql: "UPDATE league_matches SET status = 'scheduled', scheduled_at = ? WHERE id = ?",
      args: [start, matchId],
    });
  }

  it("confirms by the other captain or by an identical second report", async () => {
    const start = MONDAY + D;
    await schedule(start);
    await assert.rejects(lm.reportScore(matchId, CAP_A, 13, 7, start - H), /after the match has started/);
    await assert.rejects(lm.reportScore(matchId, CAP_A, 7, 7, start + H), /draw/);
    await lm.reportScore(matchId, CAP_A, 13, 7, start + H);
    let m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.winner, m.reportedBy], ["reported", "aaa", "aaa"]);
    await assert.rejects(lm.confirmResult(matchId, CAP_A), /other captain/);
    await lm.reportScore(matchId, CAP_B, 13, 7, start + H);
    m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.confirmedBy], ["final", CAP_B]);
  });

  it("different reports and disputes go to Match Staff", async () => {
    const start = MONDAY + D;
    await schedule(start);
    await lm.reportScore(matchId, CAP_A, 13, 7, start + H);
    await lm.reportScore(matchId, CAP_B, 7, 13, start + H);
    let m = (await lm.getLeagueMatch(matchId))!;
    assert.equal(m.status, "disputed");
    assert.match(m.note!, /13-7 vs 7-13/);

    await seed();
    await schedule(start);
    await lm.reportScore(matchId, CAP_A, 13, 9, start + H);
    await lm.disputeResult(matchId, CAP_B, "  they   had 6 players ");
    m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.note], ["disputed", "they had 6 players"]);
  });

  it("forfeit claims wait 15 minutes; conceding ends the match", async () => {
    const start = MONDAY + D;
    await schedule(start);
    await assert.rejects(lm.claimForfeit(matchId, CAP_A, start + 5 * 60_000), /15 minutes/);
    await lm.claimForfeit(matchId, CAP_A, start + 20 * 60_000);
    let m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.resultKind, m.winner], ["reported", "forfeit", "aaa"]);
    await lm.confirmResult(matchId, CAP_B);
    assert.equal((await lm.getLeagueMatch(matchId))!.status, "forfeit");

    await seed();
    await lm.concede(matchId, CAP_B);
    m = (await lm.getLeagueMatch(matchId))!;
    assert.deepEqual([m.status, m.winner], ["forfeit", "aaa"]);
    await assert.rejects(lm.concede(matchId, CAP_A), /already has a result/);
  });

  it("counts in the standings once final", async () => {
    const start = MONDAY + D;
    await schedule(start);
    await lm.reportScore(matchId, CAP_A, 13, 4, start + H);
    await lm.confirmResult(matchId, CAP_B);
    const matches = await league.seasonMatches((await lm.getLeagueMatch(matchId))!.seasonId);
    const rows = league.computeStandings(["aaa", "bbb"], matches);
    assert.deepEqual(rows.map((r) => [r.teamId, r.points, r.rd]), [["aaa", 3, 9], ["bbb", 0, -9]]);
  });
});

describe("league match page payload", () => {
  it("tells the viewer which team they captain and hides the channel id", async () => {
    const view = (await lm.leagueMatchView(matchId, CAP_B))!;
    assert.equal(view.viewer!.captainOf, "bbb");
    assert.equal(view.viewer!.onRoster, "bbb");
    assert.equal(view.teamA.roster.length, 3);
    assert.equal(new Date(view.window!.defaultSlot).toISOString(), "2099-01-11T20:00:00.000Z");
    assert.equal(new Date(view.window!.fridayDeadline).toISOString(), "2099-01-10T00:00:00.000Z");
    assert.equal(view.match.roomOpen, false);
    assert.equal("channelId" in view.match && view.match.channelId !== undefined, false);
    assert.equal((await lm.leagueMatchView(matchId, "555"))!.viewer!.captainOf, null);
  });
});
