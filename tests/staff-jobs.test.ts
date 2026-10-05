/**
 * Staff panel actions (CBL bot docs/STAFF_PANEL_PLAN.md step 1): the website
 * only queues a checked request for the bot — right role, clean input, this
 * server's guild — lists them newest first, reads the bot's result, and can
 * cancel only its own request the bot hasn't started.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTempDb } from "./helpers/temp-db";

const tmp = createTempDb("staff-jobs");
let jobs: typeof import("@/lib/staff-jobs");
let perms: typeof import("@/lib/discord-permissions");
let guildId: string;
let client: typeof import("@/lib/db").client;

const STAFF = { staff: true, admin: false, manager: false };
const NOBODY = { staff: false, admin: false, manager: false };
const ADMIN_ONLY = { staff: false, admin: true, manager: false };
const me = { discordId: "111", name: "staffer" };

before(async () => {
  jobs = await import("@/lib/staff-jobs");
  perms = await import("@/lib/discord-permissions");
  guildId = (await import("@/lib/auth")).DISCORD_CONFIG.guildId;
  client = (await import("@/lib/db")).client;
  await jobs.ensureStaffJobsTable();
});

after(async () => {
  await tmp.cleanup(["staff_jobs"]);
});

async function rejects(promise: Promise<unknown>, message: RegExp, status = 400) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof jobs.StaffJobError, String(e));
    assert.match(e.message, message);
    assert.equal(e.status, status);
    return true;
  });
}

describe("staff jobs", () => {
  it("queues a checked Elo change for this server's bot", async () => {
    const job = await jobs.createStaffJob(me, STAFF, "elo_add", { player: "  alice ", amount: "50", extra: "x" });
    assert.equal(job.status, "pending");
    assert.equal(job.summary, "Give 50 Elo to alice");
    const rs = await client.execute({ sql: "SELECT * FROM staff_jobs WHERE id = ?", args: [job.id] });
    const row = rs.rows[0] as unknown as Record<string, unknown>;
    assert.equal(row.guild_id, guildId);
    assert.equal(row.requested_by, "111");
    assert.equal(row.requested_by_name, "staffer");
    assert.deepEqual(JSON.parse(String(row.args)), { player: "alice", amount: 50 }, "only clean, known fields");
  });

  it("refuses bad input, unknown actions and the wrong role", async () => {
    await rejects(jobs.createStaffJob(me, STAFF, "elo_add", { amount: 5 }), /Player is missing/);
    await rejects(jobs.createStaffJob(me, STAFF, "elo_add", { player: "a", amount: 0 }), /between 1 and 5000/);
    await rejects(jobs.createStaffJob(me, STAFF, "elo_remove", { player: "a", amount: 2.5 }), /whole number/);
    await rejects(jobs.createStaffJob(me, STAFF, "drop_tables", {}), /Unknown action/);
    await rejects(jobs.createStaffJob(me, NOBODY, "elo_add", { player: "a", amount: 5 }), /Only Match Staff/, 403);
    await rejects(
      jobs.createStaffJob(me, ADMIN_ONLY, "elo_add", { player: "a", amount: 5 }),
      /Only Match Staff/,
      403
    );
  });

  it("keeps Admin-only actions for Administrators", async () => {
    jobs.STAFF_JOB_KINDS.test_admin = { role: "admin", validate: () => ({}), describe: () => "test" };
    try {
      assert.equal(jobs.canRequest("test_admin", STAFF), false);
      assert.equal(jobs.canRequest("test_admin", ADMIN_ONLY), true);
      await rejects(jobs.createStaffJob(me, STAFF, "test_admin", {}), /Only server Administrators/, 403);
    } finally {
      delete jobs.STAFF_JOB_KINDS.test_admin;
    }
  });

  it("lists this server's actions newest first and reads the bot's result", async () => {
    const result = {
      ok: true,
      messages: [{ content: null, ephemeral: false, embeds: [{ title: "Elo Removed", color: 15548997 }] }],
    };
    const done = await jobs.createStaffJob(me, STAFF, "elo_remove", { player: "bob", amount: 20 });
    await client.execute({
      sql: "UPDATE staff_jobs SET status = 'done', result = ?, finished_at = ? WHERE id = ?",
      args: [JSON.stringify(result), Date.now(), done.id],
    });
    await client.execute({
      sql: `INSERT INTO staff_jobs (guild_id, kind, args, requested_by, created_at)
            VALUES ('999', 'elo_add', '{"player":"x","amount":1}', '5', ?)`,
      args: [Date.now()],
    });
    const list = await jobs.listStaffJobs();
    assert.equal(list[0].id, done.id, "newest first");
    assert.ok(list.every((j) => j.requestedBy !== "5"), "another server's actions stay hidden");
    assert.equal(list[0].status, "done");
    assert.equal(list[0].result?.messages[0].embeds[0].title, "Elo Removed");
    assert.equal((await jobs.getStaffJob(done.id))?.summary, "Take 20 Elo from bob");
  });

  it("cancels only your own action the bot hasn't started", async () => {
    const waiting = await jobs.createStaffJob(me, STAFF, "elo_add", { player: "carol", amount: 5 });
    assert.equal((await jobs.cancelStaffJob(waiting.id, "222"))?.status, "pending", "not someone else's");
    assert.equal((await jobs.cancelStaffJob(waiting.id, "111"))?.status, "cancelled");

    const started = await jobs.createStaffJob(me, STAFF, "elo_add", { player: "dave", amount: 5 });
    await client.execute({ sql: "UPDATE staff_jobs SET status = 'running' WHERE id = ?", args: [started.id] });
    assert.equal((await jobs.cancelStaffJob(started.id, "111"))?.status, "running", "the bot got there first");
    assert.equal(await jobs.cancelStaffJob(987654, "111"), null);
  });
});

describe("Players tab actions", () => {
  const ADMIN = { staff: true, admin: true, manager: false };
  const ID = "300000000000000001";
  const args = async (kind: string, raw: Record<string, unknown>, roles = ADMIN) => {
    const job = await jobs.createStaffJob(me, roles, kind, raw);
    const rs = await client.execute({ sql: "SELECT args FROM staff_jobs WHERE id = ?", args: [job.id] });
    return { job, args: JSON.parse(String(rs.rows[0].args)) as Record<string, unknown> };
  };

  it("cleans the add-players list and limits it", async () => {
    const { job, args: a } = await args("player_add", { names: " alice,\nbob , Alice,, " });
    assert.deepEqual(a, { names: "alice, bob" }, "trimmed, deduped (any case), blanks dropped");
    assert.equal(job.summary, "Add players alice, bob");
    await rejects(jobs.createStaffJob(me, STAFF, "player_add", { names: " , " }), /at least one name/);
    await rejects(jobs.createStaffJob(me, STAFF, "player_add", { names: "x".repeat(33) }), /longer than 32/);
    const many = Array.from({ length: 26 }, (_, i) => `p${i}`).join(",");
    await rejects(jobs.createStaffJob(me, STAFF, "player_add", { names: many }), /at most 25/);
  });

  it("checks renames, bans and timeouts", async () => {
    await rejects(jobs.createStaffJob(me, STAFF, "player_rename", { player: "a", new_name: "a" }), /same as the old/);
    await rejects(jobs.createStaffJob(me, STAFF, "player_remove", { player: "a, b" }), /comma/);
    await rejects(jobs.createStaffJob(me, STAFF, "player_ban", { discord_id: "123", reason: "x" }), /Discord user ID/);
    await rejects(jobs.createStaffJob(me, STAFF, "player_ban", { discord_id: ID }), /Reason is missing/);
    const ban = await args("player_ban", { discord_id: ID, reason: "cheating", player: "alice" }, STAFF);
    assert.equal(ban.job.summary, "Ban alice from matchmaking");
    const unban = await args("player_unban", { discord_id: ID }, STAFF);
    assert.equal(unban.job.summary, `Lift Discord ID ${ID}'s matchmaking ban`);

    await rejects(
      jobs.createStaffJob(me, STAFF, "mod_timeout", { discord_id: ID, reason: "Being rude" }),
      /reason from the list/
    );
    await rejects(
      jobs.createStaffJob(me, STAFF, "mod_timeout", { discord_id: ID, reason: "Team killing", team_kills: 0 }),
      /between 1 and 168/
    );
    const tk = await args("mod_timeout", { discord_id: ID, reason: "Team killing", team_kills: 3, player: "alice" }, STAFF);
    assert.equal(tk.args.team_kills, 3);
    assert.equal(tk.job.summary, "Time out alice: Team killing (3)");
    const plain = await args("mod_timeout", { discord_id: ID, reason: "Trolling", team_kills: 9 }, STAFF);
    assert.equal(plain.args.team_kills, undefined, "the count only goes with Team killing");
  });

  it("keeps rewards for Administrators and checks their input", async () => {
    for (const kind of ["badge_give", "badge_remove", "seasonreward_add", "seasonreward_remove", "coins_give", "item_give", "item_take"]) {
      assert.equal(jobs.canRequest(kind, STAFF), false, kind);
      assert.equal(jobs.canRequest(kind, ADMIN_ONLY), true, kind);
    }
    await rejects(jobs.createStaffJob(me, ADMIN, "coins_give", { player: "a", amount: 0 }), /can't be 0/);
    assert.equal((await args("coins_give", { player: "a", amount: -250 })).job.summary, "Take 250 HL Coins from a");
    assert.equal((await args("item_give", { player: "a", slug: " Gold-Card " })).args.slug, "gold-card");
    await rejects(jobs.createStaffJob(me, ADMIN, "item_give", { player: "a", slug: "drop table" }), /item id/);
  });
});

describe("Ranking tab actions", () => {
  const LOBBY = "300000000000000555";
  const stored = async (kind: string, raw: Record<string, unknown>) => {
    const job = await jobs.createStaffJob(me, STAFF, kind, raw);
    const rs = await client.execute({ sql: "SELECT args FROM staff_jobs WHERE id = ?", args: [job.id] });
    return { job, args: JSON.parse(String(rs.rows[0].args)) as Record<string, unknown> };
  };

  it("takes a CBRM game id, a link to it, or #id, with an optional live match and sub picks", async () => {
    const shared = await import("@/lib/staff-shared");
    assert.equal(shared.parseCbrmGameId("https://www.playcbrm.xyz/matches/1Woq74ZG?tab=x"), "1Woq74ZG");
    assert.equal(shared.parseCbrmGameId(" #1Woq74ZG "), "1Woq74ZG");
    assert.equal(shared.parseCbrmGameId("two words"), null);

    const { job, args } = await stored("cbrm_accept", {
      game_id: "playcbrm.xyz/matches/SubGame1",
      channel_id: LOBBY,
      swaps: { "1": ["Skald_081", "SubGuy"] },
    });
    assert.deepEqual(args, { game_id: "SubGame1", channel_id: LOBBY, swaps: { "1": ["Skald_081", "SubGuy"] } });
    assert.equal(job.summary, "Rank CBRM game SubGame1");
    assert.deepEqual((await stored("cbrm_preview", { game_id: "1Woq74ZG", channel_id: "" })).args, { game_id: "1Woq74ZG" });

    await rejects(jobs.createStaffJob(me, STAFF, "cbrm_preview", { game_id: "x y" }), /Counter Blox game ID/);
    await rejects(jobs.createStaffJob(me, STAFF, "cbrm_preview", { game_id: "abc123", channel_id: "555" }), /live match/);
    await rejects(
      jobs.createStaffJob(me, STAFF, "cbrm_accept", { game_id: "abc123", swaps: { "3": ["a", "b"] } }),
      /substitution/
    );
  });

  it("checks undo, boost and roles", async () => {
    assert.equal((await stored("rank_undo", { match_id: 42 })).job.summary, "Undo ranked match 42");
    await rejects(jobs.createStaffJob(me, STAFF, "rank_undo", {}), /whole number/);
    assert.equal((await stored("elo_boost", { multiplier: 3 })).job.summary, "Start a 3x Elo boost");
    assert.equal((await stored("elo_boost", { multiplier: 1 })).job.summary, "Turn the Elo boost off");
    await rejects(jobs.createStaffJob(me, STAFF, "elo_boost", { multiplier: 4 }), /between 1 and 3/);
    assert.equal((await stored("roles_sync", { anything: 1 })).args.anything, undefined, "no input kept");
  });

  it("keeps CBRM look-ups out of Recent actions", async () => {
    await stored("cbrm_preview", { game_id: "LookOnly1" });
    const list = await jobs.listStaffJobs(100);
    assert.ok(list.every((j) => j.kind !== "cbrm_preview"));
    assert.ok(list.some((j) => j.kind === "cbrm_accept"));
  });
});

describe("Shop tab actions", () => {
  const ADMIN = { staff: true, admin: true, manager: false };
  const stored = async (kind: string, raw: Record<string, unknown>) => {
    const job = await jobs.createStaffJob(me, ADMIN, kind, raw);
    const rs = await client.execute({ sql: "SELECT args FROM staff_jobs WHERE id = ?", args: [job.id] });
    return { job, args: JSON.parse(String(rs.rows[0].args)) as Record<string, unknown> };
  };

  it("are for Administrators only", async () => {
    for (const kind of ["item_create", "item_delete", "item_price", "item_priceall"]) {
      assert.equal(jobs.canRequest(kind, STAFF), false, kind);
      assert.equal(jobs.canRequest(kind, ADMIN_ONLY), true, kind);
    }
  });

  it("checks a new item like /item create", async () => {
    const { job, args } = await stored("item_create", {
      item_type: "Badge",
      slug: "S1-Champ",
      name: "Season 1 Champion",
      asset: "champ.png",
      category: "seasonal",
      price: "250",
      extra: "dropped",
    });
    assert.deepEqual(args, {
      item_type: "badge",
      slug: "s1-champ",
      name: "Season 1 Champion",
      rarity: "common",
      price: 250,
      asset: "champ.png",
      category: "seasonal",
    });
    assert.equal(job.summary, "Create item Season 1 Champion (s1-champ)");
    const title = await stored("item_create", { item_type: "title", slug: "vet", name: "Veteran", asset: "x.png", category: "team" });
    assert.equal(title.args.asset, undefined, "titles have no image");
    assert.equal(title.args.category, undefined, "only badges have a category");
    assert.equal(title.args.price, 0, "no price = grant-only");

    const bad: [Record<string, unknown>, RegExp][] = [
      [{ item_type: "hat", slug: "x1", name: "x" }, /type/],
      [{ item_type: "card", slug: "a b", name: "x" }, /lowercase letters/],
      [{ item_type: "title", slug: "long", name: "x".repeat(25) }, /at most 24/],
      [{ item_type: "card", slug: "pricey", name: "x", price: 2_000_000 }, /between 0 and 1000000/],
      [{ item_type: "badge", slug: "cat", name: "x", category: "vip" }, /category/],
    ];
    for (const [raw, message] of bad) await rejects(jobs.createStaffJob(me, ADMIN, "item_create", raw), message);
  });

  it("prices and deletes items, but never the built-in Top 10 badge", async () => {
    assert.equal((await stored("item_price", { slug: "Gold-Card", price: 0 })).job.summary, "Take item gold-card out of the shop");
    assert.equal((await stored("item_price", { slug: "gold-card", price: 1500 })).job.summary, "Sell item gold-card for 1,500 HL Coins");
    assert.equal((await stored("item_priceall", { price: 0 })).job.summary, "Take every item out of the shop");
    for (const kind of ["item_price", "item_delete"]) {
      await rejects(jobs.createStaffJob(me, ADMIN, kind, { slug: "top10-current", price: 5 }), /Top 10 badge/);
    }
  });

  it("suggests an id from a name", async () => {
    const shared = await import("@/lib/staff-shared");
    assert.equal(shared.slugify("S1 Gold Card!"), "s1-gold-card");
    assert.equal(shared.slugify("  Café — Élite "), "cafe-elite");
  });
});

describe("Teams and Queue tab actions", () => {
  const stored = async (kind: string, raw: Record<string, unknown>) => {
    const job = await jobs.createStaffJob(me, STAFF, kind, raw);
    const rs = await client.execute({ sql: "SELECT args FROM staff_jobs WHERE id = ?", args: [job.id] });
    return { job, args: JSON.parse(String(rs.rows[0].args)) as Record<string, unknown> };
  };
  const CHANNEL = "300000000000000777";

  it("checks team titles", async () => {
    const award = await stored("team_title_award", { team: "t-alpha", title: "  Season 1   Cup  ", team_name: "Alpha" });
    assert.deepEqual(award.args, { team: "t-alpha", title: "Season 1 Cup", team_name: "Alpha" });
    assert.equal(award.job.summary, 'Award "Season 1 Cup" to Alpha');
    await rejects(jobs.createStaffJob(me, STAFF, "team_title_award", { team: "t", title: "x" }), /at least 2/);
    await rejects(jobs.createStaffJob(me, STAFF, "team_title_award", { team: "t", title: "x".repeat(61) }), /too long/);
    const remove = await stored("team_title_remove", { team: "t-alpha", title_id: 9, title: "Season 1 Cup" });
    assert.equal(remove.job.summary, 'Take "Season 1 Cup" from t-alpha');
  });

  it("checks opening, clearing, closing and switching queues", async () => {
    const open = await stored("queue_start", { region: "eu", mode: "Super", channel_id: CHANNEL, server: " " });
    assert.deepEqual(open.args, { region: "EU", mode: "super", channel_id: CHANNEL });
    assert.equal(open.job.summary, "Open the EU queue (Super Match)");
    await rejects(jobs.createStaffJob(me, STAFF, "queue_start", { region: "EU" }), /channel/);
    await rejects(jobs.createStaffJob(me, STAFF, "queue_start", { region: "MOON", channel_id: CHANNEL }), /region/);
    await rejects(jobs.createStaffJob(me, STAFF, "queue_start", { region: "EU", mode: "pro", channel_id: CHANNEL }), /Standard or Super/);

    assert.equal((await stored("queue_clear", {})).job.summary, "Clear every queue");
    assert.deepEqual((await stored("queue_close", { region: "na" })).args, { region: "NA" });
    assert.equal((await stored("queue_mode", { team_size: 3 })).job.summary, "Switch the queue to 3v3");
    await rejects(jobs.createStaffJob(me, STAFF, "queue_mode", { team_size: 4 }), /2v2, 3v3 or 5v5/);

    const link = await stored("queue_serverlink", { channel_id: CHANNEL, link: "https://roblox.com/x", match: "match #4" });
    assert.equal(link.job.summary, "Set the server link for match #4");
    await rejects(jobs.createStaffJob(me, STAFF, "queue_serverlink", { channel_id: "4", link: "x" }), /live match/);
  });
});

describe("Season tab action", () => {
  const MANAGER = { staff: false, admin: false, manager: true };

  it("is for the MatchMaking Manager role, with the name typed twice", async () => {
    assert.equal(jobs.canRequest("season_end", { staff: true, admin: true, manager: false }), false);
    assert.equal(jobs.canRequest("season_end", MANAGER), true);
    await rejects(
      jobs.createStaffJob(me, STAFF, "season_end", { season_name: "S1", badge_emoji: "🏆", confirm_name: "S1" }),
      /MatchMaking Manager/,
      403
    );
    await rejects(
      jobs.createStaffJob(me, MANAGER, "season_end", { season_name: "Season 1", badge_emoji: "🏆", confirm_name: "Season 2" }),
      /again to confirm/
    );
    await rejects(jobs.createStaffJob(me, MANAGER, "season_end", { season_name: "Season 1", confirm_name: "Season 1" }), /emoji/);
    const job = await jobs.createStaffJob(me, MANAGER, "season_end", {
      season_name: " Season   1 ",
      badge_emoji: "🏆",
      confirm_name: "Season 1",
    });
    const rs = await client.execute({ sql: "SELECT args FROM staff_jobs WHERE id = ?", args: [job.id] });
    assert.deepEqual(JSON.parse(String(rs.rows[0].args)), { season_name: "Season 1", badge_emoji: "🏆" }, "the confirm isn't sent");
    assert.equal(job.summary, 'End the season as "Season 1"');
  });
});

describe("Scoreboard form actions", () => {
  const names = "ana,ben,cai,dan,eve,fay,gus,hal,ian,jo";
  const stats = {
    kills: "20,18,15,12,10,14,12,11,9,6",
    damage: "2100,1900,1600,1300,1100,1500,1300,1200,1000,700",
    hs: "40,35.5,30,25,20,30,25,20,15,10",
  };
  const stored = async (kind: string, raw: Record<string, unknown>) => {
    const job = await jobs.createStaffJob(me, STAFF, kind, raw);
    const rs = await client.execute({ sql: "SELECT args FROM staff_jobs WHERE id = ?", args: [job.id] });
    return { job, args: JSON.parse(String(rs.rows[0].args)) as Record<string, unknown> };
  };

  it("checks /rank manual's lists like the command needs them", async () => {
    const { job, args } = await stored("rank_manual", {
      player_names: names,
      match_results: "w,w,w,w,w,l,l,l,l,l",
      points: "13, 9",
      ...stats,
      map_name: "Mirage",
      play_time: "31:20",
      subs: "eve>zed@7,4",
      channel_id: "300000000000000888",
    });
    assert.equal(args.match_results, "W,W,W,W,W,L,L,L,L,L");
    assert.equal(args.points, "13,9");
    assert.equal(args.hs, stats.hs);
    assert.equal(args.channel_id, "300000000000000888");
    assert.equal(job.summary, "Rank a match by hand: 13–9 on Mirage");

    const base = { player_names: names, match_results: "W,W,W,W,W,L,L,L,L,L", points: "13,9" };
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ...base, player_names: "ana,ana" , match_results: "W,L" }, /listed twice/],
      [{ ...base, match_results: "W,W,W,W,W,W,W,W,W,W" }, /Both teams/],
      [{ ...base, points: "9,13" }, /winners' rounds go first/],
      [{ ...base, kills: "1,2,3" }, /one whole number per player/],
      [{ ...base, hs: "40,x,1,1,1,1,1,1,1,1" }, /HS%/],
      [{ ...base, play_time: "half an hour" }, /MM:SS/],
      [{ ...base, subs: "eve then zed" }, /leaver>sub@7,4/],
      [{ ...base, mode: "4v4" }, /mode/],
    ];
    for (const [raw, message] of bad) await rejects(jobs.createStaffJob(me, STAFF, "rank_manual", raw), message);
  });

  it("checks /rank draw: team per player and equal rounds", async () => {
    const teams = "1,1,1,1,1,2,2,2,2,2";
    const { job, args } = await stored("rank_draw", { player_names: names, teams, rounds: "15,15", kills: stats.kills, hs: "1" });
    assert.equal(args.hs, undefined, "/rank draw has no HS%");
    assert.equal(job.summary, "Rank a draw by hand: 15–15");
    await rejects(jobs.createStaffJob(me, STAFF, "rank_draw", { player_names: names, teams, rounds: "15,14" }), /same rounds/);
    await rejects(jobs.createStaffJob(me, STAFF, "rank_draw", { player_names: names, teams: "1,1", rounds: "15,15" }), /team 1 or 2/);
  });

  it("keeps a screenshot's image out of what the page reads, and out of Recent actions", async () => {
    const image = "data:image/jpeg;base64," + "A".repeat(2000);
    const job = await jobs.createStaffJob(me, STAFF, "rank_screenshot", { image, image_type: "image/jpeg" });
    assert.equal(job.summary, "Read a scoreboard screenshot");
    const rs = await client.execute({ sql: "SELECT length(args) AS n FROM staff_jobs WHERE id = ?", args: [job.id] });
    assert.ok(Number(rs.rows[0].n) > 2000, "the bot gets the image");
    assert.ok((await jobs.getStaffJob(job.id)) !== null);
    assert.ok((await jobs.listStaffJobs(100)).every((j) => j.kind !== "rank_screenshot"));
    await rejects(jobs.createStaffJob(me, STAFF, "rank_screenshot", { image, image_type: "image/gif" }), /PNG, JPEG or WebP/);
    await rejects(jobs.createStaffJob(me, STAFF, "rank_screenshot", {}), /Pick a screenshot/);
  });
});

describe("Overtime vote action", () => {
  it("needs a live match and an overtime number", async () => {
    const job = await jobs.createStaffJob(me, STAFF, "overtime_vote", {
      channel_id: "300000000000000888",
      overtime: 2,
      match: "match #12",
    });
    assert.equal(job.summary, "Start an overtime 2 tie vote in match #12");
    await rejects(jobs.createStaffJob(me, STAFF, "overtime_vote", { overtime: 1 }), /live match/);
    await rejects(jobs.createStaffJob(me, STAFF, "overtime_vote", { channel_id: "300000000000000888", overtime: 0 }), /between 1 and 20/);
  });
});

describe("Administrator permission", () => {
  const guild = {
    id: "1",
    ownerId: "900",
    roles: [
      { id: "1", permissions: "0" }, // @everyone
      { id: "10", permissions: "8" }, // Administrator
      { id: "11", permissions: String(BigInt(1) << BigInt(40)) }, // a high bit, not admin
      { id: "12", permissions: "not a number" },
    ],
  };

  it("is the owner or a role with the Administrator bit", () => {
    assert.equal(perms.hasAdministrator("900", [], guild), true, "owner");
    assert.equal(perms.hasAdministrator("5", ["10"], guild), true);
    assert.equal(perms.hasAdministrator("5", ["11", "12"], guild), false);
    assert.equal(perms.hasAdministrator("5", [], guild), false);
    assert.equal(perms.hasAdministrator("", ["10"], guild), false);
    const everyoneAdmin = { ...guild, roles: [{ id: "1", permissions: "8" }] };
    assert.equal(perms.hasAdministrator("5", [], everyoneAdmin), true, "@everyone counts");
  });
});
