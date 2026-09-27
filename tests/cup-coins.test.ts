/**
 * H2 / H3 (docs/WEBSITE_SECURITY_REPORT.md): cup refunds and prizes are paid
 * exactly once even under parallel requests, and a captain's report needs the
 * other captain's confirmation before it counts.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("cupcoins");
let tournaments: typeof import("@/lib/tournaments");
let client: typeof import("@/lib/db").client;
let MAPS: string[] = [];

const STAFF = { discordId: "900", username: "staff", playerName: null, avatar: null, staff: true };
const actor = (discordId: string, name: string) => ({
  discordId,
  username: name,
  playerName: name,
  avatar: null,
  staff: false,
});
const ALICE = actor("101", "alice");
const BOB = actor("102", "bob");
const CAROL = actor("103", "carol");

async function team(id: string, name: string, tag: string, captainId: string) {
  const now = Date.now();
  const data = {
    id, name, tag, logoUrl: null, accentColor: "#ff5500", region: "EU",
    captainId, captainName: captainId, createdAt: now, updatedAt: now,
    members: [{ discordId: captainId, username: captainId, playerName: null, avatar: null,
                role: "captain", status: "accepted", joinedAt: now }],
  };
  await client.execute({
    sql: "INSERT OR REPLACE INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)",
    args: [id, JSON.stringify(data), now],
  });
}

async function coins(name: string) {
  const rs = await client.execute({ sql: "SELECT coins FROM players WHERE name = ?", args: [name] });
  return Number(rs.rows[0].coins);
}

async function setCoins(name: string, value: number) {
  await client.execute({ sql: "UPDATE players SET coins = ? WHERE name = ?", args: [value, name] });
}

/** An official cup (fee 100) with alice's and bob's teams accepted. */
async function cupWithTwoTeams(name: string) {
  const cup = await tournaments.createTournament(
    { name, kind: "official", region: "EU", bracket: "single", size: 8, bo: 1,
      entryFee: 100, mapPool: MAPS.slice(0, 1) },
    STAFF
  );
  await tournaments.requestJoin(cup.id, ALICE, "teamA");
  await tournaments.requestJoin(cup.id, BOB, "teamB");
  let t = (await tournaments.getTournament(cup.id))!;
  for (const r of t.requests.filter((x) => x.status === "pending")) {
    t = await tournaments.reviewRequest(cup.id, STAFF, r.id, true);
  }
  assert.equal(t.teams.length, 2);
  return t;
}

const settled = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((r) => r.status === "fulfilled").length;

before(async () => {
  tournaments = await import("@/lib/tournaments");
  client = (await import("@/lib/db")).client;
  MAPS = (await import("@/data/maps")).MAP_NAMES;
  await client.execute(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, elo INTEGER DEFAULT 0, rank TEXT, country TEXT,
    total_kills INTEGER, total_deaths INTEGER, total_assists INTEGER, kd_ratio REAL,
    total_mvps INTEGER, total_score INTEGER, total_headshot_percentage REAL, avg_hs_percent REAL,
    matches_played INTEGER, matches_won INTEGER, peak_elo INTEGER, total_play_time INTEGER,
    roblox_avatar_image TEXT, placement_done INTEGER DEFAULT 1, placement_games_played INTEGER,
    discord_id TEXT, discord_username TEXT, discord_avatar TEXT, mm_access INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0)`);
  await client.execute(`INSERT INTO players (name, discord_id, discord_username, coins) VALUES
    ('alice', '101', 'alice', 1000), ('bob', '102', 'bob', 1000), ('carol', '103', 'carol', 1000)`);
  const { listTeams } = await import("@/lib/teams");
  await listTeams(); // creates web_teams
  await team("teamA", "Night Owls", "OWL", "101");
  await team("teamB", "Blue Wave", "BLU", "102");
});

after(async () => {
  await tmp.cleanup(["web_tournaments", "web_teams", "coin_ledger", "players"]);
});

describe("cup coins are paid at most once", () => {
  it("charges the entry fee into the ledger", async () => {
    await setCoins("alice", 1000);
    await setCoins("bob", 1000);
    const t = await cupWithTwoTeams("Fee Cup");
    assert.equal(t.pot, 200);
    assert.equal(await coins("alice"), 900);
    const rs = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM coin_ledger WHERE key LIKE ? AND delta = -100",
      args: [`cup:${t.id}:fee:%`],
    });
    assert.equal(Number(rs.rows[0].n), 2);
    await tournaments.cancelTournament(t.id, STAFF);
  });

  it("10 parallel withdraws refund the fee once", async () => {
    await setCoins("alice", 1000);
    await setCoins("bob", 1000);
    const t = await cupWithTwoTeams("Withdraw Cup");
    const aliceTeam = t.teams.find((x) => x.captainId === "101")!;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => tournaments.withdrawTeam(t.id, ALICE, aliceTeam.id))
    );
    assert.equal(settled(results), 1);
    assert.equal(await coins("alice"), 1000);
    const after = (await tournaments.getTournament(t.id))!;
    assert.equal(after.teams.length, 1);
    assert.equal(after.pot, 100);
    await tournaments.cancelTournament(t.id, STAFF);
  });

  it("10 parallel cancels refund every team once", async () => {
    await setCoins("alice", 1000);
    await setCoins("bob", 1000);
    const t = await cupWithTwoTeams("Cancel Cup");
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => tournaments.cancelTournament(t.id, STAFF))
    );
    assert.equal(settled(results), 1);
    assert.equal(await coins("alice"), 1000);
    assert.equal(await coins("bob"), 1000);
  });

  it("a pending request refused in parallel is refunded once", async () => {
    await setCoins("carol", 1000);
    await team("teamC", "Red Storm", "RED", "103");
    const cup = await tournaments.createTournament(
      { name: "Deny Cup", kind: "official", region: "EU", bracket: "single", size: 8, bo: 1,
        entryFee: 100, mapPool: MAPS.slice(0, 1) },
      STAFF
    );
    const t = await tournaments.requestJoin(cup.id, CAROL, "teamC");
    assert.equal(await coins("carol"), 900);
    const req = t.requests[0];
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => tournaments.reviewRequest(cup.id, STAFF, req.id, false))
    );
    assert.equal(settled(results), 1);
    assert.equal(await coins("carol"), 1000);
    await tournaments.cancelTournament(cup.id, STAFF);
  });
});

describe("cup results need the other captain", () => {
  it("one captain's report doesn't count; the other's confirm does, and the prize pays once", async () => {
    await setCoins("alice", 1000);
    await setCoins("bob", 1000);
    let t = await cupWithTwoTeams("Report Cup");
    t = await tournaments.startTournament(t.id, STAFF);
    const map = MAPS[0];

    // Play every ready match: alice reports her team won, bob confirms.
    for (let guard = 0; guard < 10 && t.status === "live"; guard++) {
      const match = t.matches.find((m) => m.status === "ready")!;
      const aliceIsA = t.teams.find((x) => x.id === match.teamAId)?.captainId === "101";
      const scores = [{ map, scoreA: aliceIsA ? 13 : 5, scoreB: aliceIsA ? 5 : 13 }];

      t = await tournaments.reportMatch(t.id, ALICE, match.id, scores);
      const pending = t.matches.find((m) => m.id === match.id)!;
      assert.equal(pending.status, "ready", "a single report must not finish the match");
      assert.equal(pending.report?.by, "101");

      // Alice can't confirm her own report.
      await assert.rejects(tournaments.confirmMatch(t.id, ALICE, match.id), /other captain/);

      // Bob confirms from 5 tabs at once: exactly one wins.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => tournaments.confirmMatch(t.id, BOB, match.id))
      );
      assert.equal(settled(results), 1);
      t = (await tournaments.getTournament(t.id))!;
    }

    assert.equal(t.status, "completed");
    assert.equal(t.paidOut, true);
    // Pot 200, split 60/30/10 with no third place: winner 120 + 20, runner-up 60.
    assert.equal(await coins("alice"), 900 + 140);
    assert.equal(await coins("bob"), 900 + 60);
    const prizes = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM coin_ledger WHERE key LIKE ?",
      args: [`cup:${t.id}:prize:%`],
    });
    assert.equal(Number(prizes.rows[0].n), 2);
  });

  it("different scores become a dispute that only the organizer settles", async () => {
    await setCoins("alice", 1000);
    await setCoins("bob", 1000);
    let t = await cupWithTwoTeams("Dispute Cup");
    t = await tournaments.startTournament(t.id, STAFF);
    const map = MAPS[0];
    const match = t.matches.find((m) => m.status === "ready")!;
    const aliceIsA = t.teams.find((x) => x.id === match.teamAId)?.captainId === "101";
    const aliceWins = [{ map, scoreA: aliceIsA ? 13 : 5, scoreB: aliceIsA ? 5 : 13 }];
    const bobWins = [{ map, scoreA: aliceIsA ? 5 : 13, scoreB: aliceIsA ? 13 : 5 }];

    await tournaments.reportMatch(t.id, ALICE, match.id, aliceWins);
    t = await tournaments.reportMatch(t.id, BOB, match.id, bobWins);
    const disputed = t.matches.find((m) => m.id === match.id)!;
    assert.equal(disputed.status, "ready");
    assert.ok(disputed.dispute, "mismatched reports are flagged");

    t = await tournaments.reportMatch(t.id, STAFF, match.id, bobWins);
    const done = t.matches.find((m) => m.id === match.id)!;
    assert.equal(done.status, "completed");
    assert.equal(done.report ?? null, null);
    assert.equal(done.dispute ?? null, null);
  });

  it("an outsider can't report", async () => {
    await setCoins("alice", 1000);
    await setCoins("bob", 1000);
    let t = await cupWithTwoTeams("Outsider Cup");
    t = await tournaments.startTournament(t.id, STAFF);
    const match = t.matches.find((m) => m.status === "ready")!;
    await assert.rejects(
      tournaments.reportMatch(t.id, CAROL, match.id, [{ map: MAPS[0], scoreA: 13, scoreB: 1 }]),
      /Only the organizer or a playing captain/
    );
  });
});
