/**
 * Staff actions asked for on the website (CBL bot: docs/STAFF_PANEL_PLAN.md).
 *
 * The website saves a `staff_jobs` row; the Discord bot claims it, checks the
 * requester's roles again, runs the same code as the matching slash command
 * (cogs/staff_jobs.py) and writes the result back on the row. So a website
 * action does exactly what the command does, and the table is the log.
 *
 * Same DDL as the bot's core/staff_jobs.py, and STAFF_JOB_KINDS mirrors its
 * KINDS — keep both in sync.
 */
import { client } from "@/lib/db";
import { DISCORD_CONFIG } from "@/lib/auth";
import { ddlBatch, schemaOnce } from "@/lib/schema-once";
import { isQueueRegion } from "@/lib/regions";
import {
  BADGE_CATEGORIES,
  ITEM_RARITIES,
  ITEM_SLUG_RE,
  ITEM_TYPES,
  MAX_ITEM_PRICE,
  MAX_TEAM_KILLS,
  MAX_TITLE_LENGTH,
  TEAM_KILLING,
  TIMEOUT_REASONS,
  TOP10_BADGE_SLUG,
  parseCbrmGameId,
} from "@/lib/staff-shared";

export type StaffRole = "staff" | "admin" | "manager";
export type StaffJobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export const ensureStaffJobsTable = schemaOnce("staff_jobs", async () => {
  await ddlBatch([
    `CREATE TABLE IF NOT EXISTS staff_jobs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       guild_id TEXT NOT NULL,
       kind TEXT NOT NULL,
       args TEXT NOT NULL,
       requested_by TEXT NOT NULL,
       requested_by_name TEXT,
       status TEXT NOT NULL DEFAULT 'pending',
       result TEXT,
       created_at INTEGER NOT NULL,
       started_at INTEGER,
       finished_at INTEGER
     )`,
    "CREATE INDEX IF NOT EXISTS idx_staff_jobs_pending ON staff_jobs (guild_id, id) WHERE status = 'pending'",
    "CREATE INDEX IF NOT EXISTS idx_staff_jobs_running ON staff_jobs (guild_id) WHERE status = 'running'",
  ]);
});

/** A refusal whose message is fine to show; `status` is the HTTP status to answer with. */
export class StaffJobError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Args = Record<string, unknown>;

interface KindDef {
  role: StaffRole;
  /** Checks and normalises the form input; throws StaffJobError. */
  validate: (raw: Record<string, unknown>) => Args;
  /** One line for the Recent actions list. */
  describe: (args: Args) => string;
  /** false = a look-up, not an action: left out of Recent actions (the CBRM preview). */
  log?: boolean;
}

function text(raw: Record<string, unknown>, key: string, label: string, max = 64): string {
  const value = String(raw[key] ?? "").trim();
  if (!value) throw new StaffJobError(`${label} is missing.`);
  if (value.length > max) throw new StaffJobError(`${label} is too long.`);
  return value;
}

function whole(raw: Record<string, unknown>, key: string, label: string, lo: number, hi: number): number {
  const value = Number(raw[key]);
  if (!Number.isInteger(value)) throw new StaffJobError(`${label} must be a whole number.`);
  if (value < lo || value > hi) throw new StaffJobError(`${label} must be between ${lo} and ${hi}.`);
  return value;
}

/** An optional display name sent along with an ID-based action (ban, timeout). */
function label(raw: Record<string, unknown>): Args {
  const value = String(raw.player ?? "").trim();
  return value ? { player: value.slice(0, 64) } : {};
}

function discordId(raw: Record<string, unknown>): string {
  const value = String(raw.discord_id ?? "").trim();
  if (!/^\d{15,22}$/.test(value)) throw new StaffJobError("That isn't a Discord user ID.");
  return value;
}

/** "alice" from a labelled action, else "Discord ID 1234…". */
const who = (a: Args) => (a.player ? String(a.player) : `Discord ID ${a.discord_id}`);

const MAX_ADD_NAMES = 25;

const eloArgs = (raw: Record<string, unknown>): Args => ({
  player: text(raw, "player", "Player"),
  amount: whole(raw, "amount", "Amount", 1, 5000),
});

const playerOnly = (raw: Record<string, unknown>): Args => ({ player: text(raw, "player", "Player") });

const badgeArgs = (raw: Record<string, unknown>): Args => ({
  player: text(raw, "player", "Player"),
  badge: text(raw, "badge", "Badge"),
});

const rewardArgs = (raw: Record<string, unknown>): Args => ({
  player: text(raw, "player", "Player"),
  reward: text(raw, "reward", "Reward", 100),
});

const itemArgs = (raw: Record<string, unknown>): Args => {
  const slug = text(raw, "slug", "Item").toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(slug)) throw new StaffJobError("That isn't an item id.");
  return { player: text(raw, "player", "Player"), slug };
};

/** cbrm_preview / cbrm_accept: the game, the live match it belongs to (optional) and sub picks. */
function cbrmArgs(raw: Record<string, unknown>): Args {
  const gameId = parseCbrmGameId(String(raw.game_id ?? ""));
  if (!gameId) throw new StaffJobError("That isn't a Counter Blox game ID (e.g. 1Woq74ZG).");
  const out: Args = { game_id: gameId };
  const channel = String(raw.channel_id ?? "").trim();
  if (channel) {
    if (!/^\d{15,22}$/.test(channel)) throw new StaffJobError("Pick a live match from the list.");
    out.channel_id = channel;
  }
  if (raw.swaps != null) {
    if (typeof raw.swaps !== "object" || Array.isArray(raw.swaps)) throw new StaffJobError("Bad substitution picks.");
    const swaps: Record<string, [string | null, string | null]> = {};
    for (const [team, pick] of Object.entries(raw.swaps as Record<string, unknown>)) {
      if ((team !== "1" && team !== "2") || !Array.isArray(pick) || pick.length !== 2) {
        throw new StaffJobError("Bad substitution picks.");
      }
      swaps[team] = pick.map((n) => (n ? String(n).trim().slice(0, 64) || null : null)) as [string | null, string | null];
    }
    out.swaps = swaps;
  }
  return out;
}

/** An existing item's slug for price / delete; the built-in Top 10 badge is left alone. */
function shopSlug(raw: Record<string, unknown>): string {
  const slug = text(raw, "slug", "Item").toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(slug)) throw new StaffJobError("That isn't an item id.");
  if (slug === TOP10_BADGE_SLUG) {
    throw new StaffJobError("The Top 10 badge is given out automatically: it can't be sold or deleted here.");
  }
  return slug;
}

function oneOf(raw: Record<string, unknown>, key: string, label: string, options: readonly string[], fallback?: string): string {
  const value = String(raw[key] ?? "").trim().toLowerCase() || fallback || "";
  if (!options.includes(value)) throw new StaffJobError(`Pick a ${label} from the list.`);
  return value;
}

function itemCreateArgs(raw: Record<string, unknown>): Args {
  const type = oneOf(raw, "item_type", "type", ITEM_TYPES.map((t) => t.type));
  const slug = text(raw, "slug", "Id", 40).toLowerCase();
  if (!ITEM_SLUG_RE.test(slug)) throw new StaffJobError("The id must be 2–40 lowercase letters, digits or dashes.");
  const name = text(raw, "name", "Name");
  if (type === "title" && name.length > MAX_TITLE_LENGTH) {
    throw new StaffJobError(`A title can be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  const description = String(raw.description ?? "").trim();
  if (description.length > 200) throw new StaffJobError("The description is too long.");
  const asset = String(raw.asset ?? "").trim();
  if (asset.length > 120) throw new StaffJobError("The image name is too long.");
  const out: Args = {
    item_type: type,
    slug,
    name,
    rarity: oneOf(raw, "rarity", "rarity", ITEM_RARITIES, "common"),
    price: raw.price == null || raw.price === "" ? 0 : whole(raw, "price", "Price", 0, MAX_ITEM_PRICE),
  };
  if (description) out.description = description;
  if (asset && type !== "title") out.asset = asset;
  if (type === "badge" && raw.category) out.category = oneOf(raw, "category", "category", BADGE_CATEGORIES);
  return out;
}

const coins = (n: unknown) => `${Number(n).toLocaleString("en")} HL Coins`;

/** The bot's limit for a team title (core/team_titles.py MAX_TITLE_LENGTH). */
const MAX_TEAM_TITLE = 60;

/** A queue region; empty = every region when `optional`. */
function region(raw: Record<string, unknown>, optional: boolean): string | null {
  const value = String(raw.region ?? "").trim().toUpperCase();
  if (!value && optional) return null;
  if (!isQueueRegion(value)) throw new StaffJobError("Pick a region from the list.");
  return value;
}

/** A display label sent along (team name, match number) for Recent actions only. */
function labelArg(raw: Record<string, unknown>, key: string): Args {
  const value = String(raw[key] ?? "").trim();
  return value ? { [key]: value.slice(0, 64) } : {};
}

function snowflake(raw: Record<string, unknown>, key: string, message: string): string {
  const value = String(raw[key] ?? "").trim();
  if (!/^\d{15,22}$/.test(value)) throw new StaffJobError(message);
  return value;
}

// --- the scoreboard form (/rank manual · /rank draw), comma lists like the commands take ---

const RANK_MODES = ["5v5", "pro", "3v3", "2v2", "1v1"];
const MAX_SCOREBOARD = 12;

function csvNames(raw: Record<string, unknown>): string[] {
  const names = String(raw.player_names ?? "").split(",").map((n) => n.trim());
  if (names.length < 2 || names.some((n) => !n)) throw new StaffJobError("Every row needs a player name (2 or more players).");
  if (names.length > MAX_SCOREBOARD) throw new StaffJobError(`At most ${MAX_SCOREBOARD} players.`);
  if (names.some((n) => n.length > 32)) throw new StaffJobError("A player name is longer than 32 characters.");
  const seen = new Set(names.map((n) => n.toLowerCase()));
  if (seen.size !== names.length) throw new StaffJobError("A player is listed twice.");
  return names;
}

/** An optional per-player column: one number per player, or left out entirely. */
function csvColumn(raw: Record<string, unknown>, key: string, label: string, count: number, float = false): Args {
  const value = String(raw[key] ?? "").trim();
  if (!value) return {};
  const parts = value.split(",").map((v) => v.trim());
  const ok = float ? /^\d+(\.\d+)?$/ : /^\d+$/;
  if (parts.length !== count || parts.some((v) => !ok.test(v))) {
    throw new StaffJobError(`${label}: one ${float ? "number" : "whole number"} per player.`);
  }
  return { [key]: parts.join(",") };
}

function roundPair(raw: Record<string, unknown>, key: string, label: string): [number, number] {
  const m = /^\s*(\d{1,2})\s*,\s*(\d{1,2})\s*$/.exec(String(raw[key] ?? ""));
  if (!m) throw new StaffJobError(`${label}: two round counts, e.g. 13,9.`);
  return [Number(m[1]), Number(m[2])];
}

function rankExtras(raw: Record<string, unknown>, count: number): Args {
  const out: Args = {
    ...csvColumn(raw, "scores", "Score", count),
    ...csvColumn(raw, "kills", "Kills", count),
    ...csvColumn(raw, "deaths", "Deaths", count),
    ...csvColumn(raw, "assists", "Assists", count),
    ...csvColumn(raw, "mvps", "MVPs", count),
    ...csvColumn(raw, "damage", "Damage", count),
  };
  const mode = String(raw.mode ?? "").trim().toLowerCase();
  if (mode) {
    if (!RANK_MODES.includes(mode)) throw new StaffJobError("Pick a mode from the list.");
    out.mode = mode;
  }
  const channel = String(raw.channel_id ?? "").trim();
  if (channel) out.channel_id = snowflake(raw, "channel_id", "Pick a live match from the list.");
  return out;
}

const scoreLabel = (pair: unknown) => String(pair ?? "").replace(",", "–");

/** What the website may ask the bot to do (the bot's cogs/staff_jobs.py KINDS). */
export const STAFF_JOB_KINDS: Record<string, KindDef> = {
  elo_add: {
    role: "staff",
    validate: eloArgs,
    describe: (a) => `Give ${a.amount} Elo to ${a.player}`,
  },
  elo_remove: {
    role: "staff",
    validate: eloArgs,
    describe: (a) => `Take ${a.amount} Elo from ${a.player}`,
  },
  player_add: {
    role: "staff",
    validate: (raw) => {
      const seen = new Set<string>();
      const names: string[] = [];
      for (const name of String(raw.names ?? "").split(/[,\n]/).map((n) => n.trim())) {
        if (!name || seen.has(name.toLowerCase())) continue;
        if (name.length > 32) throw new StaffJobError(`"${name.slice(0, 40)}" is longer than 32 characters.`);
        seen.add(name.toLowerCase());
        names.push(name);
      }
      if (!names.length) throw new StaffJobError("Enter at least one name.");
      if (names.length > MAX_ADD_NAMES) throw new StaffJobError(`Add at most ${MAX_ADD_NAMES} players at once.`);
      return { names: names.join(", ") };
    },
    describe: (a) => `Add ${String(a.names).includes(",") ? "players" : "player"} ${a.names}`,
  },
  player_rename: {
    role: "staff",
    validate: (raw) => {
      const player = text(raw, "player", "Player");
      const newName = text(raw, "new_name", "New name", 32);
      if (newName === player) throw new StaffJobError("The new name is the same as the old one.");
      return { player, new_name: newName };
    },
    describe: (a) => `Rename ${a.player} to ${a.new_name}`,
  },
  player_reset_placements: {
    role: "staff",
    validate: playerOnly,
    describe: (a) => `Reset ${a.player}'s placements`,
  },
  player_remove: {
    role: "staff",
    validate: (raw) => {
      const args = playerOnly(raw);
      // /player remove splits on commas: "a, b" would remove a and b.
      if (String(args.player).includes(",")) throw new StaffJobError("A name with a comma can't be removed this way.");
      return args;
    },
    describe: (a) => `Remove player ${a.player}`,
  },
  player_ban: {
    role: "staff",
    validate: (raw) => ({ discord_id: discordId(raw), reason: text(raw, "reason", "Reason", 500), ...label(raw) }),
    describe: (a) => `Ban ${who(a)} from matchmaking`,
  },
  player_unban: {
    role: "staff",
    validate: (raw) => ({ discord_id: discordId(raw), ...label(raw) }),
    describe: (a) => `Lift ${who(a)}'s matchmaking ban`,
  },
  mod_timeout: {
    role: "staff",
    validate: (raw) => {
      const reason = text(raw, "reason", "Reason", 100);
      if (!TIMEOUT_REASONS.some((r) => r.reason === reason)) throw new StaffJobError("Pick a reason from the list.");
      const out: Args = { discord_id: discordId(raw), reason, ...label(raw) };
      if (reason === TEAM_KILLING) out.team_kills = whole(raw, "team_kills", "Team kills", 1, MAX_TEAM_KILLS);
      return out;
    },
    describe: (a) => `Time out ${who(a)}: ${a.reason}${a.team_kills ? ` (${a.team_kills})` : ""}`,
  },
  badge_give: {
    role: "admin",
    validate: badgeArgs,
    describe: (a) => `Give badge "${a.badge}" to ${a.player}`,
  },
  badge_remove: {
    role: "admin",
    validate: badgeArgs,
    describe: (a) => `Take badge "${a.badge}" from ${a.player}`,
  },
  seasonreward_add: {
    role: "admin",
    validate: rewardArgs,
    describe: (a) => `Add season reward "${a.reward}" to ${a.player}`,
  },
  seasonreward_remove: {
    role: "admin",
    validate: rewardArgs,
    describe: (a) => `Remove season reward "${a.reward}" from ${a.player}`,
  },
  coins_give: {
    role: "admin",
    validate: (raw) => {
      const amount = whole(raw, "amount", "Amount", -100_000, 100_000);
      if (amount === 0) throw new StaffJobError("Amount can't be 0.");
      return { player: text(raw, "player", "Player"), amount };
    },
    describe: (a) =>
      Number(a.amount) > 0
        ? `Give ${Number(a.amount).toLocaleString("en")} HL Coins to ${a.player}`
        : `Take ${Math.abs(Number(a.amount)).toLocaleString("en")} HL Coins from ${a.player}`,
  },
  item_give: {
    role: "admin",
    validate: itemArgs,
    describe: (a) => `Give item ${a.slug} to ${a.player}`,
  },
  item_take: {
    role: "admin",
    validate: itemArgs,
    describe: (a) => `Take item ${a.slug} from ${a.player}`,
  },
  cbrm_preview: {
    role: "staff",
    validate: cbrmArgs,
    describe: (a) => `Look up CBRM game ${a.game_id}`,
    log: false,
  },
  cbrm_accept: {
    role: "staff",
    validate: cbrmArgs,
    describe: (a) => `Rank CBRM game ${a.game_id}`,
  },
  rank_undo: {
    role: "staff",
    validate: (raw) => ({ match_id: whole(raw, "match_id", "Match", 1, 2_000_000_000) }),
    describe: (a) => `Undo ranked match ${a.match_id}`,
  },
  elo_boost: {
    role: "staff",
    validate: (raw) => ({ multiplier: whole(raw, "multiplier", "Boost", 1, 3) }),
    describe: (a) => (Number(a.multiplier) === 1 ? "Turn the Elo boost off" : `Start a ${a.multiplier}x Elo boost`),
  },
  roles_top10: {
    role: "staff",
    validate: () => ({}),
    describe: () => "Refresh the Top 10 role",
  },
  roles_sync: {
    role: "staff",
    validate: () => ({}),
    describe: () => "Sync everyone's rank and Top 10 roles",
  },
  item_create: {
    role: "admin",
    validate: itemCreateArgs,
    describe: (a) => `Create item ${a.name} (${a.slug})`,
  },
  item_delete: {
    role: "admin",
    validate: (raw) => ({ slug: shopSlug(raw) }),
    describe: (a) => `Delete item ${a.slug}`,
  },
  item_price: {
    role: "admin",
    validate: (raw) => ({ slug: shopSlug(raw), price: whole(raw, "price", "Price", 0, MAX_ITEM_PRICE) }),
    describe: (a) => (Number(a.price) > 0 ? `Sell item ${a.slug} for ${coins(a.price)}` : `Take item ${a.slug} out of the shop`),
  },
  team_title_award: {
    role: "staff",
    validate: (raw) => {
      const title = text(raw, "title", "Title", MAX_TEAM_TITLE).replace(/\s+/g, " ");
      if (title.length < 2) throw new StaffJobError("A title needs at least 2 characters.");
      return { team: text(raw, "team", "Team"), title, ...labelArg(raw, "team_name") };
    },
    describe: (a) => `Award "${a.title}" to ${a.team_name ?? a.team}`,
  },
  team_title_remove: {
    role: "staff",
    validate: (raw) => ({
      team: text(raw, "team", "Team"),
      title_id: whole(raw, "title_id", "Title", 1, 2_000_000_000),
      ...labelArg(raw, "team_name"),
      ...labelArg(raw, "title"),
    }),
    describe: (a) => `Take ${a.title ? `"${a.title}"` : "a title"} from ${a.team_name ?? a.team}`,
  },
  queue_start: {
    role: "staff",
    validate: (raw) => {
      const mode = String(raw.mode ?? "standard").trim().toLowerCase() || "standard";
      if (mode !== "standard" && mode !== "super") throw new StaffJobError("Pick Standard or Super Match.");
      const server = String(raw.server ?? "").trim();
      if (server.length > 300) throw new StaffJobError("The server link is too long.");
      return {
        region: region(raw, false),
        mode,
        channel_id: snowflake(raw, "channel_id", "Pick the channel to post the queue in."),
        ...(server ? { server } : {}),
      };
    },
    describe: (a) => `Open the ${a.region} queue (${a.mode === "super" ? "Super Match" : "Standard"})`,
  },
  queue_serverlink: {
    role: "staff",
    validate: (raw) => ({
      channel_id: snowflake(raw, "channel_id", "Pick the live match."),
      link: text(raw, "link", "Server link", 300),
      ...labelArg(raw, "match"),
    }),
    describe: (a) => `Set the server link for ${a.match ?? "a live match"}`,
  },
  queue_clear: {
    role: "staff",
    validate: (raw) => {
      const r = region(raw, true);
      return r ? { region: r } : {};
    },
    describe: (a) => (a.region ? `Clear the ${a.region} queue` : "Clear every queue"),
  },
  queue_close: {
    role: "staff",
    validate: (raw) => {
      const r = region(raw, true);
      return r ? { region: r } : {};
    },
    describe: (a) => (a.region ? `Close the ${a.region} queue` : "Close every queue"),
  },
  queue_mode: {
    role: "staff",
    validate: (raw) => {
      const size = whole(raw, "team_size", "Format", 2, 5);
      if (![2, 3, 5].includes(size)) throw new StaffJobError("Pick 2v2, 3v3 or 5v5.");
      return { team_size: size };
    },
    describe: (a) => `Switch the queue to ${a.team_size}v${a.team_size}`,
  },
  season_end: {
    role: "manager",
    validate: (raw) => {
      const name = text(raw, "season_name", "Season name", 60).replace(/\s+/g, " ");
      if (name.length < 2) throw new StaffJobError("The season name needs at least 2 characters.");
      const emoji = text(raw, "badge_emoji", "Badge emoji", 32);
      const confirm = String(raw.confirm_name ?? "").trim().replace(/\s+/g, " ");
      if (confirm !== name) throw new StaffJobError("Type the season name again to confirm.");
      return { season_name: name, badge_emoji: emoji };
    },
    describe: (a) => `End the season as "${a.season_name}"`,
  },
  rank_manual: {
    role: "staff",
    validate: (raw) => {
      const names = csvNames(raw);
      const results = String(raw.match_results ?? "").split(",").map((r) => r.trim().toUpperCase());
      if (results.length !== names.length || results.some((r) => r !== "W" && r !== "L")) {
        throw new StaffJobError("Each player needs a W or L.");
      }
      if (!results.includes("W") || !results.includes("L")) throw new StaffJobError("Both teams need players.");
      const [won, lost] = roundPair(raw, "points", "Score");
      if (won <= lost) throw new StaffJobError("The winners' rounds go first and must be more than the losers'.");
      const out: Args = {
        player_names: names.join(","),
        match_results: results.join(","),
        points: `${won},${lost}`,
        ...rankExtras(raw, names.length),
        ...csvColumn(raw, "hs", "HS%", names.length, true),
        ...csvColumn(raw, "rounds_played", "Rounds played", names.length),
      };
      const mapName = String(raw.map_name ?? "").trim();
      if (mapName) out.map_name = mapName.slice(0, 40);
      const region = String(raw.region ?? "").trim();
      if (region) out.region = region.slice(0, 20);
      const playTime = String(raw.play_time ?? "").trim();
      if (playTime) {
        if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(playTime)) throw new StaffJobError("Play time is MM:SS or H:MM:SS.");
        out.play_time = playTime;
      }
      const subs = String(raw.subs ?? "").trim();
      if (subs) {
        if (subs.length > 200 || !/^[^>;]+>[^@;]+@\d{1,2},\d{1,2}(;[^>;]+>[^@;]+@\d{1,2},\d{1,2})*$/.test(subs)) {
          throw new StaffJobError("Subs are leaver>sub@7,4 (several separated by ;).");
        }
        out.subs = subs;
      }
      return out;
    },
    describe: (a) => `Rank a match by hand: ${scoreLabel(a.points)}${a.map_name ? ` on ${a.map_name}` : ""}`,
  },
  rank_draw: {
    role: "staff",
    validate: (raw) => {
      const names = csvNames(raw);
      const teams = String(raw.teams ?? "").split(",").map((t) => t.trim());
      if (teams.length !== names.length || teams.some((t) => t !== "1" && t !== "2")) {
        throw new StaffJobError("Each player needs team 1 or 2.");
      }
      if (!teams.includes("1") || !teams.includes("2")) throw new StaffJobError("Both teams need players.");
      const [a, b] = roundPair(raw, "rounds", "Score");
      if (a !== b) throw new StaffJobError("A draw has the same rounds for both teams.");
      return { player_names: names.join(","), teams: teams.join(","), rounds: `${a},${b}`, ...rankExtras(raw, names.length) };
    },
    describe: (a) => `Rank a draw by hand: ${scoreLabel(a.rounds)}`,
  },
  rank_screenshot: {
    role: "staff",
    validate: (raw) => {
      const image = String(raw.image ?? "");
      if (!image) throw new StaffJobError("Pick a screenshot.");
      if (image.length > 5_600_000) throw new StaffJobError("The screenshot is too big.");
      const type = String(raw.image_type ?? "image/png");
      if (!["image/png", "image/jpeg", "image/webp"].includes(type)) throw new StaffJobError("Use a PNG, JPEG or WebP image.");
      const out: Args = { image, image_type: type };
      const channel = String(raw.channel_id ?? "").trim();
      if (channel) out.channel_id = snowflake(raw, "channel_id", "Pick a live match from the list.");
      return out;
    },
    describe: () => "Read a scoreboard screenshot",
    log: false,
  },
  overtime_vote: {
    role: "staff",
    validate: (raw) => ({
      channel_id: snowflake(raw, "channel_id", "Pick the live match."),
      overtime: whole(raw, "overtime", "Overtime", 1, 20),
      ...labelArg(raw, "match"),
    }),
    describe: (a) => `Start an overtime ${a.overtime} tie vote${a.match ? ` in ${a.match}` : ""}`,
  },
  item_priceall: {
    role: "admin",
    validate: (raw) => ({ price: whole(raw, "price", "Price", 0, MAX_ITEM_PRICE) }),
    describe: (a) => (Number(a.price) > 0 ? `Put every item in the shop at ${coins(a.price)}` : "Take every item out of the shop"),
  },
};

export interface StaffJobEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string }[];
  footer?: string;
}

export interface StaffJobMessage {
  content: string | null;
  ephemeral: boolean;
  embeds: StaffJobEmbed[];
}

export interface StaffJobResult {
  ok: boolean;
  error?: string;
  messages: StaffJobMessage[];
  /** What a look-up hands back (the CBRM preview). */
  data?: unknown;
}

export interface StaffJob {
  id: number;
  kind: string;
  summary: string;
  requestedBy: string;
  requestedByName: string | null;
  status: StaffJobStatus;
  result: StaffJobResult | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface StaffActor {
  discordId: string;
  name: string;
}

export interface StaffRoles {
  staff: boolean;
  admin: boolean;
  /** The MatchMaking Manager role (ending a season). */
  manager: boolean;
}

function guildId(): string {
  return DISCORD_CONFIG.guildId;
}

/** The row without a screenshot's image (it can be megabytes, and the summary doesn't need it). */
const JOB_COLUMNS = `id, kind, requested_by, requested_by_name, status, result, created_at, finished_at,
  CASE WHEN kind = 'rank_screenshot' THEN '{}' ELSE args END AS args`;

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function describe(kind: string, args: Args | null): string {
  const def = STAFF_JOB_KINDS[kind];
  if (!def || !args) return kind;
  try {
    return def.describe(args);
  } catch {
    return kind;
  }
}

function toJob(row: Record<string, unknown>): StaffJob {
  const kind = String(row.kind);
  const result = parseJson<StaffJobResult>(row.result);
  return {
    id: Number(row.id),
    kind,
    summary: describe(kind, parseJson<Args>(row.args)),
    requestedBy: String(row.requested_by),
    requestedByName: row.requested_by_name == null ? null : String(row.requested_by_name),
    status: String(row.status) as StaffJobStatus,
    result: result
      ? { ok: !!result.ok, error: result.error, messages: result.messages ?? [], data: result.data }
      : null,
    createdAt: Number(row.created_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  };
}

/** True when these roles may ask for this kind of action. */
export function canRequest(kind: string, roles: StaffRoles): boolean {
  const def = STAFF_JOB_KINDS[kind];
  if (!def) return false;
  return def.role === "admin" ? roles.admin : def.role === "manager" ? roles.manager : roles.staff;
}

/** Check the input and queue the action for the bot. */
export async function createStaffJob(
  actor: StaffActor,
  roles: StaffRoles,
  kind: string,
  rawArgs: unknown
): Promise<StaffJob> {
  const def = STAFF_JOB_KINDS[kind];
  if (!def) throw new StaffJobError("Unknown action.");
  if (!canRequest(kind, roles)) {
    throw new StaffJobError(
      def.role === "admin"
        ? "Only server Administrators can do this."
        : def.role === "manager"
          ? "Only the MatchMaking Manager role can do this."
          : "Only Match Staff can do this.",
      403
    );
  }
  const raw = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
  const args = def.validate(raw);
  await ensureStaffJobsTable();
  const rs = await client.execute({
    sql: `INSERT INTO staff_jobs (guild_id, kind, args, requested_by, requested_by_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          RETURNING ${JOB_COLUMNS}`,
    args: [guildId(), kind, JSON.stringify(args), actor.discordId, actor.name.slice(0, 64), Date.now()],
  });
  return toJob(rs.rows[0] as unknown as Record<string, unknown>);
}

export async function getStaffJob(id: number): Promise<StaffJob | null> {
  await ensureStaffJobsTable();
  const rs = await client.execute({
    sql: `SELECT ${JOB_COLUMNS} FROM staff_jobs WHERE id = ? AND guild_id = ?`,
    args: [id, guildId()],
  });
  const row = rs.rows[0] as unknown as Record<string, unknown> | undefined;
  return row ? toJob(row) : null;
}

/** Kinds that are look-ups, not actions (kept out of Recent actions). */
const UNLOGGED = Object.entries(STAFF_JOB_KINDS)
  .filter(([, def]) => def.log === false)
  .map(([kind]) => kind);

/** Newest first — the Recent actions list (look-ups left out). */
export async function listStaffJobs(limit = 30): Promise<StaffJob[]> {
  await ensureStaffJobsTable();
  const skip = UNLOGGED.map(() => "?").join(", ");
  const rs = await client.execute({
    sql: `SELECT ${JOB_COLUMNS} FROM staff_jobs WHERE guild_id = ?${skip ? ` AND kind NOT IN (${skip})` : ""}
          ORDER BY id DESC LIMIT ?`,
    args: [guildId(), ...UNLOGGED, Math.max(1, Math.min(100, limit))],
  });
  return rs.rows.map((r) => toJob(r as unknown as Record<string, unknown>));
}

/**
 * The page stopped waiting: cancel the job if the bot hasn't started it, so
 * it can't run later by surprise. Only the person who asked can cancel.
 * Returns the job as it is now (still running if the bot got there first).
 */
export async function cancelStaffJob(id: number, discordId: string): Promise<StaffJob | null> {
  await ensureStaffJobsTable();
  await client.execute({
    sql: `UPDATE staff_jobs SET status = 'cancelled', finished_at = ?
          WHERE id = ? AND guild_id = ? AND status = 'pending' AND requested_by = ?`,
    args: [Date.now(), id, guildId(), discordId],
  });
  return getStaffJob(id);
}
