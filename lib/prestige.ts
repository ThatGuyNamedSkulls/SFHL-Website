/**
 * Season prestige (docs/QUEUE_UI_PLAN.md, Q4): every 20 ranked wins in a season
 * is one prestige level, up to Prestige 5 (100 wins). It starts again each
 * season. Each level reached pays HL Coins once (coin ledger key
 * `prestige:<season>:<playerId>:<level>`) and grants the "Prestige N" badge,
 * which the player keeps.
 *
 * Wins are counted from match_history since the last /season reset, because
 * players.matches_won is a career total that survives resets. Placement and
 * test (dummy) matches don't count.
 */
import { client, getSeasonResets } from "@/lib/db";
import { coinMoveStatements, ensureCoinLedger, isDuplicateKeyError, type Stmt } from "@/lib/coin-ledger";
import { ensureCosmeticsSchema } from "@/lib/cosmetics";
import { addNotification } from "@/lib/social";

export const PRESTIGE_WINS_PER_LEVEL = 20;
export const PRESTIGE_MAX_LEVEL = 5;
export const PRESTIGE_COINS_PER_LEVEL = 500;

export interface PrestigeProgress {
  /** Ranked wins this season. */
  wins: number;
  level: number;
  maxed: boolean;
  /** Wins needed for the next level (null at max). */
  nextAt: number | null;
  /** Wins counted toward the next level (0..PRESTIGE_WINS_PER_LEVEL). */
  winsIntoLevel: number;
  winsPerLevel: number;
  maxLevel: number;
  coinsPerLevel: number;
}

/** Prestige level and progress for a number of season wins (pure). */
export function prestigeFromWins(rawWins: number): PrestigeProgress {
  const wins = Math.max(0, Math.floor(Number(rawWins) || 0));
  const level = Math.min(PRESTIGE_MAX_LEVEL, Math.floor(wins / PRESTIGE_WINS_PER_LEVEL));
  const maxed = level >= PRESTIGE_MAX_LEVEL;
  return {
    wins,
    level,
    maxed,
    nextAt: maxed ? null : (level + 1) * PRESTIGE_WINS_PER_LEVEL,
    winsIntoLevel: maxed ? PRESTIGE_WINS_PER_LEVEL : wins - level * PRESTIGE_WINS_PER_LEVEL,
    winsPerLevel: PRESTIGE_WINS_PER_LEVEL,
    maxLevel: PRESTIGE_MAX_LEVEL,
    coinsPerLevel: PRESTIGE_COINS_PER_LEVEL,
  };
}

export interface SeasonInfo {
  /** 1 before any /season reset, then +1 per reset. */
  number: number;
  label: string;
  /** UTC "YYYY-MM-DD HH:MM:SS" of the last reset (the season's start), or null. */
  startedAt: string | null;
  /** Stable id for ledger keys. */
  key: string;
}

export async function currentSeason(): Promise<SeasonInfo> {
  const resets = await getSeasonResets();
  const last = resets.length ? String(resets[resets.length - 1].reset_at) : null;
  const number = resets.length + 1;
  return { number, label: `Season ${number}`, startedAt: last, key: last ?? "season-1" };
}

/** Ranked wins this season (distinct matches; no placements, no dummy matches). */
export async function seasonWins(playerName: string, startedAt: string | null): Promise<number> {
  const rs = await client.execute({
    sql: `SELECT COUNT(DISTINCT COALESCE(match_id, -id)) AS c FROM match_history
          WHERE (player_id = (SELECT id FROM players WHERE name = ?) OR player_name = ?)
            AND result = 'W'
            AND COALESCE(is_test, 0) = 0
            AND COALESCE(is_placement, 0) = 0
            AND (? IS NULL OR timestamp >= ?)`,
    args: [playerName, playerName, startedAt, startedAt],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

const RARITY = ["uncommon", "rare", "epic", "legendary", "mythic"];

function badgeSlug(level: number) {
  return `prestige-${level}`;
}

/** The catalog row for one prestige badge (idempotent). */
function badgeItemStatement(level: number): Stmt {
  return {
    sql: `INSERT OR IGNORE INTO cosmetic_items
          (slug, type, name, description, asset, category, season, rarity, created_at, price)
          VALUES (?, 'badge', ?, ?, ?, 'prestige', NULL, ?, ?, 0)`,
    args: [
      badgeSlug(level),
      `Prestige ${level}`,
      `Reached Prestige ${level}: ${level * PRESTIGE_WINS_PER_LEVEL} ranked wins in one season.`,
      `/badges/prestige-${level}.svg`,
      RARITY[level - 1] ?? "legendary",
      Date.now(),
    ],
  };
}

export interface PrestigeStatus extends PrestigeProgress {
  season: SeasonInfo;
  /** Levels whose reward was paid by this call. */
  newlyReached: number[];
}

/**
 * The player's prestige this season, paying any level not yet rewarded: HL
 * Coins (once per season, level and player — the ledger key makes parallel
 * calls safe) and the "Prestige N" badge. Sends a site notification per new level.
 */
export async function syncPrestige(playerName: string): Promise<PrestigeStatus> {
  const season = await currentSeason();
  const progress = prestigeFromWins(await seasonWins(playerName, season.startedAt));
  const status: PrestigeStatus = { ...progress, season, newlyReached: [] };
  if (progress.level === 0) return status;

  const idRs = await client.execute({ sql: "SELECT id FROM players WHERE name = ?", args: [playerName] });
  const playerId = idRs.rows[0]?.id;
  if (playerId == null) return status;

  await Promise.all([ensureCoinLedger(), ensureCosmeticsSchema()]);
  const keyFor = (level: number) => `prestige:${season.key}:${playerId}:${level}`;
  const levels = Array.from({ length: progress.level }, (_, i) => i + 1);
  const paidRs = await client.execute({
    sql: `SELECT key FROM coin_ledger WHERE key IN (${levels.map(() => "?").join(",")})`,
    args: levels.map(keyFor),
  });
  const paid = new Set(paidRs.rows.map((r) => String(r.key)));
  const missing = levels.filter((level) => !paid.has(keyFor(level)));
  if (!missing.length) return status;

  for (const level of missing) {
    try {
      // One transaction: the coins (once, by ledger key), the catalog row, the badge.
      await client.batch(
        [
          ...coinMoveStatements({
            key: keyFor(level),
            playerName,
            delta: PRESTIGE_COINS_PER_LEVEL,
            reason: `Prestige ${level} · ${season.label}`,
          }),
          badgeItemStatement(level),
          {
            sql: `INSERT OR IGNORE INTO cosmetic_inventory
                  (player_name, player_id, item_id, granted_by, granted_at)
                  SELECT ?, ?, id, 'system:prestige', ? FROM cosmetic_items WHERE slug = ?`,
            args: [playerName, Number(playerId), Date.now(), badgeSlug(level)],
          },
        ],
        "write"
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) continue; // another request just paid it
      throw error;
    }
    status.newlyReached.push(level);
    await addNotification(
      playerName,
      "prestige",
      `You reached Prestige ${level} in ${season.label}! +${PRESTIGE_COINS_PER_LEVEL} HL Coins and the Prestige ${level} badge.`
    ).catch(() => undefined);
  }
  return status;
}
