/**
 * Upcoming Overview player cards (docs/LEAGUE_V2_PLAN.md C1): your team's main
 * roster with you in the middle; a sub sits in the middle next to the top 4
 * starters by Elo.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("league-lineup");
let lineup: typeof import("@/lib/league-lineup");
let league: typeof import("@/lib/league");
let admin: typeof import("@/lib/league-admin");
let client: typeof import("@/lib/db").client;

const TABLES = ["league_events", "league_entries", "league_divisions", "league_seasons", "web_teams", "players"];
const STAFF = { discordId: "900", name: "Mod" };

before(async () => {
  lineup = await import("@/lib/league-lineup");
  league = await import("@/lib/league");
  admin = await import("@/lib/league-admin");
  client = (await import("@/lib/db")).client;
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await client.execute(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER, country TEXT, roblox_avatar_image TEXT)"
  );
});

after(async () => {
  await tmp.cleanup(TABLES);
});

describe("arrangeLineup", () => {
  const p = (key: string, elo: number | null) => ({ key, elo });

  it("puts me in the middle and the best Elo closest to me", () => {
    const me = p("me", 1500);
    const slots = lineup.arrangeLineup(me, [p("a", 1000), me, p("b", 2000), p("c", 1800), p("d", null), p("e", 1200)]);
    assert.deepEqual(slots.map((s) => s?.key), ["e", "b", "me", "c", "a"]);
  });

  it("a sub is in the middle with the top 4 starters", () => {
    const sub = p("sub", 900);
    const slots = lineup.arrangeLineup(sub, [p("a", 1000), p("b", 2000), p("c", 1800), p("d", 1500), p("e", 1200)]);
    // b (2000) left of the sub, c (1800) right, then d (1500) and e (1200) outside; a (1000) is left out.
    assert.deepEqual(slots.map((s) => s?.key), ["d", "b", "sub", "c", "e"]);
  });

  it("fewer teammates leave the outer spots empty", () => {
    const me = p("me", 1500);
    assert.deepEqual(lineup.arrangeLineup(me, [me, p("a", 1000)]).map((s) => s?.key ?? null), [null, "a", "me", null, null]);
  });
});

describe("viewerLineup", () => {
  async function addTeam(id: string, captain: string, members: [string, string][], updatedAt: number) {
    const team = {
      id, name: `Team ${id}`, tag: id.toUpperCase().slice(0, 4), logoUrl: null, accentColor: "#ff5500", region: "EU",
      captainId: captain, captainName: `p${captain}`,
      members: members.map(([d, role]) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
        role, status: "accepted", joinedAt: 0 })),
      createdAt: 0, updatedAt,
    };
    await client.execute({ sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [id, JSON.stringify(team), updatedAt] });
  }

  it("uses the signed-up team, ranks each card and marks captain, me and subs", async () => {
    const elo: Record<string, [number, number]> = { "1": [2600, 1], "2": [1900, 1], "3": [1300, 1], "4": [800, 0], "5": [2100, 1], "6": [1500, 1] };
    for (const [id, [e, placed]] of Object.entries(elo)) {
      await client.execute({
        sql: "INSERT INTO players (name, elo, placement_done, country, roblox_avatar_image) VALUES (?, ?, ?, 'PT', ?)",
        args: [`p${id}`, e, placed, id === "1" ? "https://img/1.png" : null],
      });
    }
    // Player 6 is a sub on "main" and captains "side", which isn't signed up.
    await addTeam("main", "1", [["1", "captain"], ["2", "starter"], ["3", "starter"], ["4", "starter"], ["5", "starter"], ["6", "sub"]], 1);
    await addTeam("side", "6", [["6", "captain"]], 99);
    const s = await admin.createSeason("S", STAFF);
    await admin.openSignups(s.id, 7, STAFF);
    await league.signUpTeam("main", "1");

    const sub = (await lineup.viewerLineup(s.id, "6"))!;
    assert.deepEqual([sub.team.id, sub.signedUp], ["main", true]);
    // Starters by Elo: p1 2600, p5 2100, p2 1900, p3 1300 (p4 is unranked, so 5th and left out).
    assert.deepEqual(sub.cards.map((c) => c?.name), ["p2", "p1", "p6", "p5", "p3"]);
    const [, top, middle] = sub.cards;
    assert.deepEqual([middle!.me, middle!.sub, middle!.rank, middle!.country], [true, true, "A3", "pt"]);
    assert.deepEqual([top!.captain, top!.elo, top!.rank, top!.avatar], [true, 2600, "STAR", "https://img/1.png"]);

    const starter = (await lineup.viewerLineup(s.id, "4"))!;
    assert.equal(starter.cards[2]!.name, "p4");
    assert.deepEqual([starter.cards[2]!.elo, starter.cards[2]!.rank], [null, "UNRANKED"], "placements not done");
    assert.deepEqual(starter.cards.map((c) => c?.name), ["p2", "p1", "p4", "p5", "p3"]);

    assert.equal(await lineup.viewerLineup(s.id, "777"), null, "no team");
  });
});
