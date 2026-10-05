/**
 * What the staff panel shows about one player (CBL bot docs/STAFF_PANEL_PLAN.md
 * step 2): read straight from the database, no bot needed. Changes go through
 * the bot (lib/staff-jobs.ts).
 *
 * Some tables (bans, timeouts, leaves) only exist once the bot has created
 * them, so every read falls back to "nothing" instead of failing the page.
 */
import { client, publicRating } from "@/lib/db";
import { pickAvatar } from "@/lib/avatar";

export interface StaffPlayerView {
  player: {
    name: string;
    /** Raw Elo, also during placements (staff see the real number). */
    elo: number;
    /** Tier letter for the rank badge ("UNRANKED" during placements). */
    tier: string;
    rank: string;
    placementDone: boolean;
    placementGames: number;
    matchesPlayed: number;
    matchesWon: number;
    discordId: string | null;
    discordUsername: string | null;
    avatarUrl: string;
    coins: number;
    seasonRewards: string[];
  };
  ban: { reason: string; bannedBy: string; bannedAt: string } | null;
  warnings: number;
  timeouts: { reason: string; minutes: number; moderator: string; at: string }[];
  leaves: { eloPenalty: number; count: number; at: string }[];
  badges: string[];
  inventory: { slug: string; name: string; type: string }[];
}

export interface StaffCatalog {
  items: { slug: string; name: string; type: string }[];
  /** Badge names already given to someone, for suggestions. */
  badges: string[];
}

type Row = Record<string, unknown>;

async function rows(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try {
    const rs = await client.execute({ sql, args });
    return rs.rows as unknown as Row[];
  } catch {
    return []; // table not created yet
  }
}

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => Number(v) || 0;

/** Season rewards are stored as "Reward A, Reward B, " (the bot appends "reward, "). */
export function splitSeasonRewards(raw: unknown): string[] {
  return str(raw)
    .split(", ")
    .map((r) => r.trim())
    .filter(Boolean);
}

async function findPlayer(name: string): Promise<Row | null> {
  const select = `SELECT id, name, elo, rank, placement_done, placement_games_played, matches_played,
                         matches_won, CAST(discord_id AS TEXT) AS discord_id, discord_username,
                         discord_avatar, roblox_avatar_image, COALESCE(coins, 0) AS coins,
                         COALESCE(season_rewards, '') AS season_rewards
                    FROM players`;
  const exact = await rows(`${select} WHERE name = ? LIMIT 1`, [name]);
  if (exact[0]) return exact[0];
  const loose = await rows(`${select} WHERE name = ? COLLATE NOCASE LIMIT 1`, [name]);
  return loose[0] ?? null;
}

export async function staffPlayerView(name: string): Promise<StaffPlayerView | null> {
  const p = await findPlayer(name.trim());
  if (!p) return null;
  const playerName = str(p.name);
  const discordId = p.discord_id ? str(p.discord_id) : null;
  const byDiscord = (sql: string) => (discordId ? rows(sql, [discordId]) : Promise.resolve([]));

  const [ban, warnings, timeouts, leaves, badges, inventory] = await Promise.all([
    byDiscord(
      `SELECT reason, banned_by, banned_at FROM player_bans
        WHERE discord_id = ? AND lifted_at IS NULL ORDER BY id DESC LIMIT 1`
    ),
    byDiscord("SELECT warning_count FROM warnings WHERE discord_id = ? ORDER BY id DESC LIMIT 1"),
    byDiscord(
      `SELECT reason, duration_minutes, moderator_name, timestamp FROM timeouts
        WHERE discord_id = ? ORDER BY id DESC LIMIT 10`
    ),
    byDiscord(
      `SELECT elo_penalty, incident_count, timestamp FROM leaving_incidents
        WHERE discord_id = ? ORDER BY id DESC LIMIT 10`
    ),
    rows("SELECT badge_name FROM badges WHERE player_name = ? ORDER BY id", [playerName]),
    rows(
      `SELECT i.slug, i.name, i.type FROM cosmetic_inventory ci
         JOIN cosmetic_items i ON i.id = ci.item_id
        WHERE ci.player_name = ? ORDER BY i.type, i.name`,
      [playerName]
    ),
  ]);

  const rating = publicRating({
    elo: num(p.elo),
    rank: str(p.rank),
    placement_done: num(p.placement_done),
  });
  return {
    player: {
      name: playerName,
      elo: num(p.elo),
      tier: rating.rank,
      rank: str(p.rank),
      placementDone: rating.placementDone,
      placementGames: num(p.placement_games_played),
      matchesPlayed: num(p.matches_played),
      matchesWon: num(p.matches_won),
      discordId,
      discordUsername: p.discord_username ? str(p.discord_username) : null,
      avatarUrl: pickAvatar(
        p.roblox_avatar_image as string | null,
        p.discord_avatar as string | null,
        discordId
      ),
      coins: num(p.coins),
      seasonRewards: splitSeasonRewards(p.season_rewards),
    },
    ban: ban[0]
      ? { reason: str(ban[0].reason), bannedBy: str(ban[0].banned_by), bannedAt: str(ban[0].banned_at) }
      : null,
    warnings: num(warnings[0]?.warning_count),
    timeouts: timeouts.map((t) => ({
      reason: str(t.reason),
      minutes: num(t.duration_minutes),
      moderator: str(t.moderator_name),
      at: str(t.timestamp),
    })),
    leaves: leaves.map((l) => ({ eloPenalty: num(l.elo_penalty), count: num(l.incident_count), at: str(l.timestamp) })),
    badges: badges.map((b) => str(b.badge_name)),
    inventory: inventory.map((i) => ({ slug: str(i.slug), name: str(i.name), type: str(i.type) })),
  };
}

export async function staffCatalog(): Promise<StaffCatalog> {
  const [items, badges] = await Promise.all([
    rows("SELECT slug, name, type FROM cosmetic_items ORDER BY type, name"),
    rows("SELECT DISTINCT badge_name FROM badges ORDER BY badge_name LIMIT 200"),
  ]);
  return {
    items: items.map((i) => ({ slug: str(i.slug), name: str(i.name), type: str(i.type) })),
    badges: badges.map((b) => str(b.badge_name)),
  };
}
