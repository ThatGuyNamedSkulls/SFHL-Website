/**
 * Team League match actions on the website (phase 3): propose / accept /
 * decline a time, report / confirm / dispute a result, claim a forfeit or
 * concede. Same rules as the bot's core/league_matches.py — keep them in sync.
 * The bot's league loop does the timed parts (default slot, reminders, match
 * room, escalation, result posts).
 */
import { client } from "@/lib/db";
import { defaultSlot, ensureLeagueSchema, getSeason, weekWindow, type Season } from "@/lib/league";
import { ensureSocialSchema } from "@/lib/social";
import { logEvent, type Actor } from "@/lib/league-admin";
import { getTeam } from "@/lib/teams";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const PROPOSE_MIN_LEAD_MS = 30 * MINUTE;
export const ROOM_OPEN_LEAD_MS = 15 * MINUTE;
export const FORFEIT_CLAIM_AFTER_MS = 15 * MINUTE;
export const CONFIRM_WINDOW_MS = 12 * HOUR;
export const MAX_SCORE = 99;
const REMIND_24H = 1;
const DONE = new Set(["final", "forfeit"]);

export interface MatchRow {
  id: number;
  seasonId: number;
  divisionId: number | null;
  week: number;
  stage: string;
  teamA: string;
  teamB: string;
  bo: number;
  status: string;
  proposedTime: number | null;
  proposedBy: string | null;
  scheduledAt: number | null;
  channelId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  reportedBy: string | null;
  reportedAt: number | null;
  resultKind: string | null;
  confirmedBy: string | null;
  note: string | null;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

function toMatch(r: Record<string, unknown>): MatchRow {
  return {
    id: Number(r.id),
    seasonId: Number(r.season_id),
    divisionId: n(r.division_id),
    week: Number(r.week),
    stage: String(r.stage),
    teamA: String(r.team_a),
    teamB: String(r.team_b),
    bo: Number(r.bo ?? 1),
    status: String(r.status),
    proposedTime: n(r.proposed_time),
    proposedBy: s(r.proposed_by),
    scheduledAt: n(r.scheduled_at),
    channelId: s(r.channel_id),
    scoreA: n(r.score_a),
    scoreB: n(r.score_b),
    winner: s(r.winner),
    reportedBy: s(r.reported_by),
    reportedAt: n(r.reported_at),
    resultKind: s(r.result_kind),
    confirmedBy: s(r.confirmed_by),
    note: s(r.note),
  };
}

export async function getLeagueMatch(id: number): Promise<MatchRow | null> {
  await ensureLeagueSchema();
  const rs = await client.execute({ sql: "SELECT * FROM league_matches WHERE id = ?", args: [id] });
  const r = rs.rows[0] as Record<string, unknown> | undefined;
  return r ? toMatch(r) : null;
}

async function update(id: number, cols: Record<string, string | number | null>): Promise<void> {
  const all = { ...cols, updated_at: Date.now() };
  const keys = Object.keys(all);
  await client.execute({
    sql: `UPDATE league_matches SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    args: [...keys.map((k) => all[k as keyof typeof all]), id],
  });
}

export class LeagueActionError extends Error {}
const fail = (message: string): never => {
  throw new LeagueActionError(message);
};

// --- teams ---------------------------------------------------------------------------------

export interface MatchTeam {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
  captainId: string | null;
  roster: { discordId: string; playerName: string | null; username: string }[];
}

export async function matchTeam(seasonId: number, teamId: string): Promise<MatchTeam> {
  const rs = await client.execute({
    sql: "SELECT team_name, team_tag, captain_id, roster FROM league_entries WHERE season_id = ? AND team_id = ?",
    args: [seasonId, teamId],
  });
  const e = rs.rows[0] as Record<string, unknown> | undefined;
  let roster: MatchTeam["roster"] = [];
  try {
    roster = JSON.parse(String(e?.roster ?? "[]"));
  } catch {
    /* keep empty */
  }
  const team = await getTeam(teamId);
  return {
    id: teamId,
    name: team?.name ?? String(e?.team_name ?? teamId),
    tag: team?.tag ?? String(e?.team_tag ?? ""),
    logoUrl: team?.logoUrl ?? null,
    accentColor: team?.accentColor ?? "#ff5500",
    captainId: team?.captainId ?? s(e?.captain_id),
    roster,
  };
}

const label = (t: MatchTeam) => (t.tag ? `${t.name} [${t.tag}]` : t.name);
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:F>`;

async function dm(discordIds: (string | null)[], message: string): Promise<void> {
  const ids = [...new Set(discordIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await ensureSocialSchema();
  const now = Date.now();
  for (const id of ids) {
    await client.execute({
      sql: "INSERT INTO discord_dm_outbox (discord_id, message, sent, created_at) VALUES (?, ?, 0, ?)",
      args: [id, message, now],
    });
  }
}

interface Ctx {
  match: MatchRow;
  season: Season;
  a: MatchTeam;
  b: MatchTeam;
  /** The team the acting captain leads. */
  team: string;
}

async function captainCtx(matchId: number, discordId: string): Promise<Ctx> {
  const match = await getLeagueMatch(matchId);
  if (!match) fail("League match not found.");
  const season = await getSeason(match!.seasonId);
  if (!season || (season.status !== "regular" && season.status !== "playoffs")) {
    fail("This season isn't being played right now.");
  }
  const a = await matchTeam(match!.seasonId, match!.teamA);
  const b = await matchTeam(match!.seasonId, match!.teamB);
  const team = a.captainId === discordId ? a.id : b.captainId === discordId ? b.id : null;
  if (!team) fail("Only the two team captains can do that.");
  return { match: match!, season: season!, a, b, team: team! };
}

function other(ctx: Ctx): MatchTeam {
  return ctx.team === ctx.a.id ? ctx.b : ctx.a;
}

// --- scheduling ------------------------------------------------------------------------------

export async function proposeTime(matchId: number, discordId: string, when: number, now = Date.now()) {
  const ctx = await captainCtx(matchId, discordId);
  const { match, season } = ctx;
  if (!["unscheduled", "proposed", "scheduled"].includes(match.status)) {
    fail("This match can't be rescheduled any more.");
  }
  if (!season.startDate) fail("The season hasn't started yet.");
  const { start, end } = weekWindow(season.startDate!, match.week);
  if (!Number.isFinite(when) || when < start || when > end) {
    fail("Pick a time inside the match week (Monday 00:00 – Sunday 23:59 UTC).");
  }
  if (when < now + PROPOSE_MIN_LEAD_MS) fail("Pick a time at least 30 minutes from now.");
  await update(match.id, { status: "proposed", proposed_time: Math.round(when), proposed_by: ctx.team });
  await dm(
    [other(ctx).captainId],
    `🗓️ ${label(ctx.team === ctx.a.id ? ctx.a : ctx.b)} proposed ${ts(when)} for your league match ` +
      `(week ${match.week}). Accept it on the website (League tab) or with \`/leaguematch accept\`.`
  );
}

export async function acceptTime(matchId: number, discordId: string, now = Date.now()) {
  const ctx = await captainCtx(matchId, discordId);
  const { match } = ctx;
  if (match.status !== "proposed" || match.proposedTime === null) fail("There's no time proposal to accept.");
  if (match.proposedBy === ctx.team) fail("The other captain has to accept your proposal.");
  if (match.proposedTime! < now + ROOM_OPEN_LEAD_MS) fail("That time has (nearly) passed — propose a new one.");
  const when = match.proposedTime!;
  await update(match.id, {
    status: "scheduled",
    scheduled_at: when,
    proposed_time: null,
    proposed_by: null,
    reminded: when - now <= DAY ? REMIND_24H : 0,
  });
  await dm(
    [...ctx.a.roster, ...ctx.b.roster].map((p) => p.discordId),
    `🏆 League match **${label(ctx.a)} vs ${label(ctx.b)}** (week ${match.week}) is scheduled for ${ts(when)}.`
  );
}

export async function declineTime(matchId: number, discordId: string) {
  const ctx = await captainCtx(matchId, discordId);
  if (ctx.match.status !== "proposed") fail("There's no time proposal to decline.");
  await update(ctx.match.id, {
    status: ctx.match.scheduledAt ? "scheduled" : "unscheduled",
    proposed_time: null,
    proposed_by: null,
  });
  await dm([other(ctx).captainId], `Your proposed time for the week ${ctx.match.week} league match was declined.`);
}

// --- results ---------------------------------------------------------------------------------

function checkScores(a: number, b: number) {
  for (const x of [a, b]) {
    if (!Number.isInteger(x) || x < 0 || x > MAX_SCORE) fail(`Scores must be whole numbers from 0 to ${MAX_SCORE}.`);
  }
  if (a === b) fail("League matches can't end in a draw — report the winner's score.");
}

/** Scores are team A – team B. */
export async function reportScore(matchId: number, discordId: string, scoreA: number, scoreB: number, now = Date.now()) {
  const ctx = await captainCtx(matchId, discordId);
  const { match } = ctx;
  checkScores(scoreA, scoreB);
  if (match.status === "reported" && match.reportedBy !== ctx.team) {
    const same = match.resultKind === "score" && match.scoreA === scoreA && match.scoreB === scoreB;
    if (same) await update(match.id, { status: "final", confirmed_by: discordId });
    else {
      await update(match.id, {
        status: "disputed",
        note: `Scores don't match: ${match.scoreA}-${match.scoreB} vs ${scoreA}-${scoreB}`,
      });
    }
    return;
  }
  const started = match.status === "live" || (match.scheduledAt !== null && match.scheduledAt <= now);
  if (!["scheduled", "live", "reported"].includes(match.status) || !started) {
    fail("Report the score after the match has started.");
  }
  await update(match.id, {
    status: "reported",
    score_a: scoreA,
    score_b: scoreB,
    winner: scoreA > scoreB ? match.teamA : match.teamB,
    result_kind: "score",
    reported_by: ctx.team,
    reported_at: now,
    note: null,
  });
  await dm(
    [other(ctx).captainId],
    `📝 Result reported for your league match: ${label(ctx.a)} ${scoreA} – ${scoreB} ${label(ctx.b)}. ` +
      "Confirm or dispute it on the website (League tab) or with `/leaguematch`."
  );
}

export async function claimForfeit(matchId: number, discordId: string, now = Date.now()) {
  const ctx = await captainCtx(matchId, discordId);
  const { match } = ctx;
  if (!["scheduled", "live"].includes(match.status) || match.scheduledAt === null) {
    fail("A forfeit can only be claimed for a scheduled match.");
  }
  if (now < match.scheduledAt! + FORFEIT_CLAIM_AFTER_MS) {
    fail("Wait until 15 minutes after the start before claiming a forfeit.");
  }
  await update(match.id, {
    status: "reported",
    score_a: null,
    score_b: null,
    winner: ctx.team,
    result_kind: "forfeit",
    reported_by: ctx.team,
    reported_at: now,
    note: "Forfeit claimed (no-show)",
  });
  await dm(
    [other(ctx).captainId],
    `⚠️ A forfeit win was claimed against your team in the week ${match.week} league match (no-show). ` +
      "Confirm or dispute it on the website or with `/leaguematch`."
  );
}

export async function concede(matchId: number, discordId: string) {
  const ctx = await captainCtx(matchId, discordId);
  if (DONE.has(ctx.match.status)) fail("This match already has a result.");
  await update(ctx.match.id, {
    status: "forfeit",
    winner: other(ctx).id,
    score_a: null,
    score_b: null,
    result_kind: "forfeit",
    reported_by: ctx.team,
    confirmed_by: discordId,
    note: `Conceded by ${ctx.team}`,
  });
}

export async function confirmResult(matchId: number, discordId: string) {
  const ctx = await captainCtx(matchId, discordId);
  if (ctx.match.status !== "reported") fail("There's no reported result to confirm.");
  if (ctx.match.reportedBy === ctx.team) fail("The other captain has to confirm your report.");
  await update(ctx.match.id, {
    status: ctx.match.resultKind === "forfeit" ? "forfeit" : "final",
    confirmed_by: discordId,
  });
}

export async function disputeResult(matchId: number, discordId: string, reason: string) {
  const ctx = await captainCtx(matchId, discordId);
  if (ctx.match.status !== "reported") fail("There's no reported result to dispute.");
  if (ctx.match.reportedBy === ctx.team) fail("You reported this result — report again to change it.");
  const note = reason.split(/\s+/).join(" ").trim().slice(0, 200) || "Disputed by the other captain";
  await update(ctx.match.id, { status: "disputed", note });
}

// --- Match Staff ---------------------------------------------------------------------------

/** Set or override any result (Match Staff). */
export async function staffSetResult(
  matchId: number,
  input: { winner: string; scoreA?: number | null; scoreB?: number | null; forfeit?: boolean },
  actor: Actor
) {
  const match = await getLeagueMatch(matchId);
  if (!match) fail("League match not found.");
  const m = match!;
  if (input.winner !== m.teamA && input.winner !== m.teamB) fail("The winner must be one of the two teams.");
  let cols: Record<string, string | number | null>;
  if (input.forfeit) {
    cols = { status: "forfeit", score_a: null, score_b: null, result_kind: "forfeit" };
  } else {
    const a = Number(input.scoreA);
    const b = Number(input.scoreB);
    if (input.scoreA == null || input.scoreB == null) fail("Give both scores, or mark it as a forfeit.");
    checkScores(a, b);
    if (a > b !== (input.winner === m.teamA)) fail("The winner must have the higher score.");
    cols = { status: "final", score_a: a, score_b: b, result_kind: "score" };
  }
  await update(m.id, { ...cols, winner: input.winner, confirmed_by: `staff:${actor.discordId}`, note: null });
  const [ta, tb] = [await matchTeam(m.seasonId, m.teamA), await matchTeam(m.seasonId, m.teamB)];
  const line = input.forfeit
    ? `${label(input.winner === ta.id ? ta : tb)} win by forfeit`
    : `${label(ta)} ${input.scoreA} – ${input.scoreB} ${label(tb)}`;
  await logEvent(m.seasonId, "result_set", actor, line, m.id);
}

/** Move a match that hasn't started (Match Staff); both rosters get a DM. */
export async function staffReschedule(matchId: number, when: number, actor: Actor, now = Date.now()) {
  const match = await getLeagueMatch(matchId);
  if (!match) fail("League match not found.");
  const m = match!;
  if (!["unscheduled", "proposed", "scheduled"].includes(m.status)) {
    fail("Only matches that haven't started can be moved.");
  }
  if (!Number.isFinite(when) || when < now) fail("That time is in the past.");
  await update(m.id, {
    status: "scheduled",
    scheduled_at: Math.round(when),
    proposed_time: null,
    proposed_by: null,
    reminded: when - now <= DAY ? REMIND_24H : 0,
  });
  const [ta, tb] = [await matchTeam(m.seasonId, m.teamA), await matchTeam(m.seasonId, m.teamB)];
  await dm(
    [...ta.roster, ...tb.roster].map((p) => p.discordId),
    `🗓️ Match Staff moved your league match **${label(ta)} vs ${label(tb)}** (week ${m.week}) to ${ts(when)}.`
  );
  await logEvent(m.seasonId, "match_rescheduled", actor, `${label(ta)} vs ${label(tb)} → ${new Date(when).toISOString().slice(0, 16).replace("T", " ")} UTC`, m.id);
}

// --- page payload ----------------------------------------------------------------------------

export async function leagueMatchView(matchId: number, viewerId: string | null, staff = false) {
  const match = await getLeagueMatch(matchId);
  if (!match) return null;
  const season = await getSeason(match.seasonId);
  if (!season) return null;
  const a = await matchTeam(match.seasonId, match.teamA);
  const b = await matchTeam(match.seasonId, match.teamB);
  const window = season.startDate
    ? {
        ...weekWindow(season.startDate, match.week),
        defaultSlot: defaultSlot(season.startDate, match.week),
        fridayDeadline: weekWindow(season.startDate, match.week).start + 5 * DAY,
      }
    : null;
  const captainOf = viewerId
    ? a.captainId === viewerId
      ? a.id
      : b.captainId === viewerId
        ? b.id
        : null
    : null;
  const onRoster = viewerId
    ? a.roster.some((p) => p.discordId === viewerId)
      ? a.id
      : b.roster.some((p) => p.discordId === viewerId)
        ? b.id
        : null
    : null;
  const teamView = (t: MatchTeam) => ({
    id: t.id,
    name: t.name,
    tag: t.tag,
    logoUrl: t.logoUrl,
    accentColor: t.accentColor,
    captainId: t.captainId,
    roster: t.roster.map((p) => ({ discordId: p.discordId, name: p.playerName || p.username })),
  });
  return {
    match: { ...match, channelId: undefined, roomOpen: !!match.channelId },
    season: { id: season.id, name: season.name, status: season.status },
    window,
    teamA: teamView(a),
    teamB: teamView(b),
    viewer: viewerId ? { captainOf, onRoster, staff } : null,
    rules: {
      proposeMinLeadMs: PROPOSE_MIN_LEAD_MS,
      forfeitClaimAfterMs: FORFEIT_CLAIM_AFTER_MS,
      confirmWindowMs: CONFIRM_WINDOW_MS,
    },
  };
}

export type LeagueMatchView = NonNullable<Awaited<ReturnType<typeof leagueMatchView>>>;
