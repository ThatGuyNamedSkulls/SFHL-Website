/**
 * Substitute slots — the website half of a flow the bot owns.
 *
 * The bot writes `sub_requests` when Match Staff run `/sub` (see the project's
 * `cogs/subs.py` and `core/sub_requests.py`). The site lists the open ones and
 * can claim one, which is a single conditional UPDATE — `WHERE status = 'open'`
 * — so two people clicking at the same instant can never both win the slot.
 * A claim leaves `applied = 0`; the bot's poller then grants Discord channel
 * access and adds the player to the lobby roster, the same handshake the map
 * veto already uses.
 *
 * The Elo band and the eligibility rules are duplicated from `core/subs.py`
 * rather than fetched, because they're cheap pure functions and the two sides
 * must agree: a slot must not be claimable through one door under rules the
 * other door would reject. Keep them in sync with `[elo.sub]` in
 * `config/games/counterstrike.toml`.
 */

import { client, getPlayer, mapRank } from "@/lib/db";
import { getActiveLobbyMemberIds } from "@/lib/lobby";
import { prettyMap } from "@/lib/format";
import { SubRequestView } from "@/types";

/** `[seconds open, Elo band]`, mirroring `elo.sub.band_steps`. */
export const SUB_BAND_STEPS: [number, number][] = [
  [60, 100],
  [180, 200],
  [360, 350],
];

/** Mirrors `elo.sub.max_per_day`. */
export const SUB_MAX_PER_DAY = 3;

interface SubRequestRow {
  id: number;
  channel_id: string;
  guild_id: string | null;
  region: string | null;
  mode: string | null;
  team: number;
  map_name: string | null;
  leaver_name: string;
  leaver_discord_id: string | null;
  sub_name: string | null;
  sub_discord_id: string | null;
  status: string;
  target_elo: number | null;
  swap_score: string | null;
  applied: number;
  match_id: number | null;
  created_at: number;
  filled_at: number | null;
}

const COLUMNS = `id, channel_id, CAST(guild_id AS TEXT) AS guild_id, region, mode, team,
                 map_name, leaver_name, CAST(leaver_discord_id AS TEXT) AS leaver_discord_id,
                 sub_name, CAST(sub_discord_id AS TEXT) AS sub_discord_id, status,
                 target_elo, swap_score, applied, match_id, created_at, filled_at`;

// ---------------------------------------------------------------------------
// Band math (mirrors core/subs.py)
// ---------------------------------------------------------------------------

/**
 * The Elo band a claimer must fall inside. Starts tight so the replacement
 * resembles the player they replace, then widens so a slot always fills.
 */
export function bandFor(openSeconds: number): number | null {
  for (const [after, band] of SUB_BAND_STEPS) {
    if (openSeconds < after) return band;
  }
  return null;
}

export function inBand(
  elo: number,
  targetElo: number | null,
  band: number | null
): boolean {
  if (band === null || targetElo === null) return true;
  return Math.abs(elo - targetElo) <= band;
}

/**
 * Seconds until the widening band admits this Elo, or null if it already does.
 * Lets a card show "eligible in 40s" instead of silently hiding itself.
 */
export function secondsUntilEligible(
  elo: number,
  targetElo: number | null,
  openSeconds: number
): number | null {
  if (targetElo === null) return null;
  if (inBand(elo, targetElo, bandFor(openSeconds))) return null;
  const gap = Math.abs(elo - targetElo);
  // A step `[after, band]` means "band applies until `after` seconds", so a
  // band becomes active at the PREVIOUS step's threshold.
  let activeFrom = 0;
  for (const [after, band] of SUB_BAND_STEPS) {
    if (gap <= band) return Math.max(0, activeFrom - openSeconds);
    activeFrom = after;
  }
  return Math.max(0, activeFrom - openSeconds);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function loadOpenRows(): Promise<SubRequestRow[]> {
  try {
    const rs = await client.execute(
      `SELECT ${COLUMNS} FROM sub_requests WHERE status = 'open' ORDER BY created_at ASC`
    );
    return rs.rows as unknown as SubRequestRow[];
  } catch {
    // The bot may not have created the table yet — no slots, not an error.
    return [];
  }
}

async function loadRow(id: number): Promise<SubRequestRow | null> {
  try {
    const rs = await client.execute({
      sql: `SELECT ${COLUMNS} FROM sub_requests WHERE id = ?`,
      args: [id],
    });
    return (rs.rows[0] as unknown as SubRequestRow) ?? null;
  } catch {
    return null;
  }
}

/** Sub appearances this user claimed in the last 24h (the daily cap). */
async function subsToday(discordId: string): Promise<number> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  try {
    const rs = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM sub_requests
             WHERE sub_discord_id = ? AND status = 'filled' AND filled_at >= ?`,
      args: [discordId, cutoff],
    });
    return Number((rs.rows[0] as unknown as { n: number })?.n ?? 0);
  } catch {
    return 0;
  }
}

/** A slot this user already claimed that hasn't been played yet. */
async function activeClaim(discordId: string): Promise<SubRequestRow | null> {
  try {
    const rs = await client.execute({
      sql: `SELECT ${COLUMNS} FROM sub_requests
             WHERE sub_discord_id = ? AND status = 'filled' AND match_id IS NULL
             ORDER BY filled_at DESC LIMIT 1`,
      args: [discordId],
    });
    return (rs.rows[0] as unknown as SubRequestRow) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface Claimer {
  discordId: string;
  playerName: string | null;
  inGuild: boolean;
}

interface Blocker {
  reason: string;
  /** Set when the only problem is the band, which widens with time. */
  eligibleInSeconds?: number | null;
}

/**
 * Everything about a viewer that doesn't depend on which slot they're looking
 * at, resolved once per request. The queue page polls the slot list every five
 * seconds, so doing these lookups per row would multiply the query count by
 * the number of open slots for no benefit.
 */
interface ViewerContext {
  claimer: Claimer | null;
  elo: number;
  /** A reason that rules the viewer out of every slot, if any. */
  blocked: string | null;
}

function isRanked(placementDone: unknown, rank: string | null | undefined): boolean {
  if (!placementDone) return false;
  return mapRank(rank || "") !== "UNRANKED";
}

async function viewerContext(claimer: Claimer | null): Promise<ViewerContext> {
  const ctx: ViewerContext = { claimer, elo: 0, blocked: null };

  if (!claimer) {
    ctx.blocked = "Log in to join a match as a substitute.";
    return ctx;
  }
  if (!claimer.inGuild) {
    ctx.blocked = "You must be a member of the HyperLeague Discord server to sub.";
    return ctx;
  }
  if (!claimer.playerName) {
    ctx.blocked =
      "Your Discord account isn't linked to a HyperLeague player. Contact an admin.";
    return ctx;
  }

  const player = await getPlayer(claimer.playerName);
  if (!player) {
    ctx.blocked = "You're not registered in the league yet, so you can't sub.";
    return ctx;
  }
  ctx.elo = Number(player.elo ?? 0);
  if (!isRanked(player.placement_done, player.rank)) {
    ctx.blocked =
      "Unranked players can't join as a substitute. Finish your placement matches first.";
    return ctx;
  }

  const inMatch = await getActiveLobbyMemberIds();
  if (inMatch.has(claimer.discordId)) {
    ctx.blocked = "You're already in a live match.";
    return ctx;
  }
  if (await activeClaim(claimer.discordId)) {
    ctx.blocked = "You've already claimed a sub slot that hasn't been played yet.";
    return ctx;
  }
  if ((await subsToday(claimer.discordId)) >= SUB_MAX_PER_DAY) {
    ctx.blocked = `You've already subbed ${SUB_MAX_PER_DAY} times today — that's the daily limit.`;
    return ctx;
  }

  return ctx;
}

/**
 * Why this viewer may not take this slot, or null if they may. Mirrors
 * `_claim_blocker` in the bot's subs cog, minus the Discord-timeout check
 * (which needs the guild member object); as with queueing, that one is
 * enforced Discord-side.
 */
function claimBlocker(ctx: ViewerContext, row: SubRequestRow): Blocker | null {
  if (row.status !== "open") return { reason: "That slot has already been filled." };
  if (ctx.blocked) return { reason: ctx.blocked };
  if (ctx.claimer && ctx.claimer.discordId === row.leaver_discord_id) {
    return { reason: "You can't sub in for yourself." };
  }

  const openSeconds = (Date.now() - Number(row.created_at)) / 1000;
  const band = bandFor(openSeconds);
  if (!inBand(ctx.elo, row.target_elo, band)) {
    return {
      reason: `Your Elo (${ctx.elo}) is outside this slot's current range (${row.target_elo} ± ${band}) — it keeps the teams balanced.`,
      eligibleInSeconds: secondsUntilEligible(ctx.elo, row.target_elo, openSeconds),
    };
  }

  return null;
}

function toView(row: SubRequestRow, blocker: Blocker | null): SubRequestView {
  const openSeconds = Math.max(0, (Date.now() - Number(row.created_at)) / 1000);
  return {
    id: Number(row.id),
    channelId: String(row.channel_id),
    guildId: row.guild_id ? String(row.guild_id) : null,
    region: row.region,
    mode: row.mode,
    team: Number(row.team),
    map: prettyMap(row.map_name),
    leaver: row.leaver_name,
    targetElo: row.target_elo === null ? null : Number(row.target_elo),
    swapScore: row.swap_score,
    openedAt: Number(row.created_at),
    openSeconds,
    band: bandFor(openSeconds),
    eligible: blocker === null,
    reason: blocker?.reason ?? null,
    eligibleInSeconds: blocker?.eligibleInSeconds ?? null,
    channelUrl:
      row.guild_id && row.channel_id
        ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}`
        : null,
  };
}

/** Every open slot, annotated with whether this viewer can take it. */
export async function listSubRequests(
  claimer: Claimer | null
): Promise<SubRequestView[]> {
  const rows = await loadOpenRows();
  if (rows.length === 0) return [];  // nothing open: no viewer lookups at all
  const ctx = await viewerContext(claimer);
  return rows.map((row) => toView(row, claimBlocker(ctx, row)));
}

export type ClaimResult =
  | { ok: true; request: SubRequestView }
  | { ok: false; error: string; status: number };

/**
 * Take a slot. The conditional UPDATE is the whole concurrency story: exactly
 * one of two simultaneous claims reports a changed row, and the loser is told
 * the slot is gone rather than silently overwriting the winner.
 */
export async function claimSubRequest(
  claimer: Claimer,
  requestId: number
): Promise<ClaimResult> {
  const row = await loadRow(requestId);
  if (!row) return { ok: false, error: "That slot no longer exists.", status: 404 };

  const blocker = claimBlocker(await viewerContext(claimer), row);
  if (blocker) return { ok: false, error: blocker.reason, status: 403 };
  if (!claimer.playerName) {
    return { ok: false, error: "Your Discord account isn't linked to a HyperLeague player.", status: 403 };
  }

  let changed = 0;
  try {
    const rs = await client.execute({
      sql: `UPDATE sub_requests
               SET status = 'filled', sub_name = ?, sub_discord_id = ?,
                   claim_source = 'website', filled_at = ?, applied = 0
             WHERE id = ? AND status = 'open'`,
      args: [claimer.playerName, claimer.discordId, Date.now(), requestId],
    });
    changed = Number(rs.rowsAffected ?? 0);
  } catch {
    return { ok: false, error: "Failed to claim that slot.", status: 500 };
  }
  if (!changed) {
    return { ok: false, error: "Someone just took that slot — sorry!", status: 409 };
  }

  // Claiming a match means leaving the queue: you can't be waiting for a match
  // and playing one at the same time.
  try {
    await client.execute({
      sql: "DELETE FROM web_queue WHERE discord_user_id = ?",
      args: [claimer.discordId],
    });
  } catch {
    /* best effort — the bot's queue poll reconciles anyway */
  }

  const claimed = (await loadRow(requestId)) ?? row;
  return { ok: true, request: toView(claimed, null) };
}

/**
 * Give a slot back, only while the bot hasn't acted on it yet. Once access has
 * been granted and the match channel knows about the sub, withdrawing is a
 * staff decision (`/cancelsub`), not a self-service one.
 */
export async function withdrawSubClaim(
  claimer: Claimer,
  requestId: number
): Promise<{ ok: boolean; error?: string; status?: number }> {
  try {
    const rs = await client.execute({
      sql: `UPDATE sub_requests
               SET status = 'open', sub_name = NULL, sub_discord_id = NULL,
                   claim_source = NULL, filled_at = NULL
             WHERE id = ? AND sub_discord_id = ? AND status = 'filled' AND applied = 0`,
      args: [requestId, claimer.discordId],
    });
    if (!Number(rs.rowsAffected ?? 0)) {
      return {
        ok: false,
        error: "Too late to withdraw — the match already has you in it. Tell Match Staff.",
        status: 409,
      };
    }
  } catch {
    return { ok: false, error: "Failed to withdraw.", status: 500 };
  }
  return { ok: true };
}
