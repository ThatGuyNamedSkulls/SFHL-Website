/**
 * Query budgets (docs/PERFORMANCE_PLAN.md step 17): each key page loader may
 * make at most this many database round trips (every one is a network trip to
 * Turso). If a change pushes a loader over, this fails — raise the number only
 * on purpose. Measured after the tables exist (a warm server instance).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

process.env.HL_LEAGUE_ROSTER_MIN = "1";
const tmp = createTempDb("query-budget");
let client: typeof import("@/lib/db").client;
let onDbTrip: typeof import("@/lib/db").onDbTrip;
let league: typeof import("@/lib/league");
let admin: typeof import("@/lib/league-admin");
let shell: typeof import("@/lib/league-shell");
let teamPage: typeof import("@/lib/team-page");
let playoffs: typeof import("@/lib/league-playoffs");

const TABLES = [
  "league_byes", "league_team_access", "league_events", "league_matches", "league_entries", "league_divisions",
  "league_seasons", "league_team_posts", "league_player_posts", "league_applications", "league_match_stats",
  "league_pro_elo", "web_teams", "players", "team_titles", "cosmetic_inventory", "cosmetic_items",
];
const STAFF = { discordId: "900", name: "Mod" };

/** Round trips made by `fn`. */
async function trips(fn: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const stop = onDbTrip(() => {
    n += 1;
  });
  try {
    await fn();
  } finally {
    stop();
  }
  return n;
}

let seasonId = 0;

before(async () => {
  ({ client, onDbTrip } = await import("@/lib/db"));
  league = await import("@/lib/league");
  admin = await import("@/lib/league-admin");
  shell = await import("@/lib/league-shell");
  teamPage = await import("@/lib/team-page");
  playoffs = await import("@/lib/league-playoffs");
  await league.ensureLeagueSchema();
  await (await import("@/lib/teams")).listTeams();
  await client.execute(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, elo INTEGER, placement_done INTEGER, country TEXT)"
  );
  // 8 teams of 2 in one band: an 8-team Swiss division, started.
  for (let t = 0; t < 8; t++) {
    const ids = [String(4000 + t * 10), String(4001 + t * 10)];
    const team = {
      id: `q${t}`, name: `Q ${t}`, tag: `Q${t}`, logoUrl: null, accentColor: "#ff5500", region: "EU",
      captainId: ids[0], captainName: `p${ids[0]}`,
      members: ids.map((d, i) => ({ discordId: d, username: `u${d}`, playerName: `p${d}`, avatar: null,
        role: i === 0 ? "captain" : "starter", status: "accepted", joinedAt: 0 })),
      createdAt: 0, updatedAt: 0,
    };
    await client.execute({ sql: "INSERT INTO web_teams (id, data, updated_at) VALUES (?, ?, ?)", args: [team.id, JSON.stringify(team), t] });
    for (const d of ids) {
      await client.execute({ sql: "INSERT INTO players (name, elo, placement_done, country) VALUES (?, ?, 1, 'pt')", args: [`p${d}`, 1500] });
    }
  }
  const s = await admin.createSeason("Budget", STAFF);
  await admin.openSignups(s.id, 7, STAFF);
  for (let t = 0; t < 8; t++) await league.signUpTeam(`q${t}`, String(4000 + t * 10));
  await admin.closeSignups(s.id, STAFF);
  await admin.startSeason(s.id, "2099-01-05", STAFF, Date.UTC(2098, 0, 1));
  seasonId = s.id;
  // Warm-up: every table/cosmetic/title setup has run once, like a warm server.
  await teamPage.teamPageData("q0", "4000");
  await playoffs.divisionStandings(seasonId);
});

after(async () => {
  await tmp.cleanup(TABLES);
});

describe("database round trips per page loader", () => {
  const BUDGETS: [string, number, () => Promise<unknown>][] = [
    // Measured 2026-09-25: 8 / 3 / 4 / 10.
    ["league view (logged in)", 10, () => league.leagueView(seasonId, "4000")],
    ["league tabs + counts (layout)", 4, () => shell.leagueShell(seasonId)],
    ["standings order (every division)", 5, () => playoffs.divisionStandings(seasonId)],
    ["team page", 12, () => teamPage.teamPageData("q0", "4000")],
  ];
  for (const [name, budget, fn] of BUDGETS) {
    it(`${name}: at most ${budget}`, async () => {
      const n = await trips(fn);
      console.log(`  ${name}: ${n} round trips (budget ${budget})`);
      assert.ok(n <= budget, `${name} made ${n} round trips (budget ${budget})`);
    });
  }
});
