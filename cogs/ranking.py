"""Ranking commands: /rank, /ranktie, /ocr2rank, /addelo, /removeelo,
/refresh_top10, /update_roles.

Elo/rank/achievement logic comes from core.*; Top 10 maintenance from cogs.roles.
DB access uses core.db.connect (no shared global cursor).
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

from config.settings import TOP10_ROLE_NAME, TOP10_MIN_ELO, TOP10_COUNT
from core import db
from core.game_profile import ACTIVE as GAME
from core.ranks import RANK_THRESHOLDS, get_rank, determine_rank, get_placement_elo, get_tie_points
from core.elo import calculate_new_elo, calculate_new_elo_team
from core import glicko2
from core.players import get_player_elo, update_player_elo
from core.achievements import update_achievement_progress, revert_achievement_progress
from cogs.shared import has_required_role, player_name_choices
from cogs.roles import refresh_top10_roles

logger = logging.getLogger(__name__)

_RANK_NAMES = {name for _, _, name in RANK_THRESHOLDS}


def _rank_for_elo(elo):
    return next((name for low, high, name in RANK_THRESHOLDS if low <= elo <= high), "[?] Unranked")


_RANK_ORDER = {name: i for i, (_, _, name) in enumerate(RANK_THRESHOLDS)}


def _rank_index(rank_name):
    """Ordinal position of a rank (higher = better); -1 if unknown."""
    return _RANK_ORDER.get(rank_name, -1)


def _strip_quotes(s: str) -> str:
    """Strip surrounding whitespace and stray single/double quotes from a value.

    Users (and copy-pasted /ocr2rank output) sometimes wrap values in quotes,
    e.g. scores:"72,48" — without this the leading `"` breaks int parsing.
    """
    return s.strip().strip('"').strip("'").strip()


def _csv(raw: str):
    """Split a (possibly quote-wrapped) comma list into cleaned tokens."""
    return [_strip_quotes(tok) for tok in _strip_quotes(raw).split(",")]


def _parse_play_time(value: str):
    """Parse a play-time value to whole seconds. Accepts 'MM:SS', 'HH:MM:SS', or
    a plain integer number of seconds. Returns None if it can't be parsed."""
    value = _strip_quotes(value)
    try:
        if ":" in value:
            parts = [int(p) for p in value.split(":")]
            seconds = 0
            for p in parts:
                seconds = seconds * 60 + p
            return seconds
        return int(value)
    except ValueError:
        return None


def _inactivity_periods(last_played):
    """Rating periods (~days, capped at 365) since a player last played — for Glicko decay."""
    if not last_played:
        return 0.0
    try:
        dt = datetime.fromisoformat(last_played)
    except (ValueError, TypeError):
        return 0.0
    return max(0.0, min((datetime.now() - dt).total_seconds() / 86400.0, 365.0))


async def _sync_member_rank_role(member, new_rank, rank_roles):
    """Remove any of our rank roles from `member` and add the one for `new_rank`."""
    try:
        roles_to_remove = [r for r in member.roles if r.name in _RANK_NAMES]
        if roles_to_remove:
            await member.remove_roles(*roles_to_remove, reason="Rank updated")
        new_role = rank_roles.get(new_rank)
        if new_role and new_role not in member.roles:
            await member.add_roles(new_role, reason="Rank updated")
        elif not new_role:
            logger.warning(f"Rank role '{new_rank}' not found for {member.display_name}")
    except Exception as e:
        logger.error(f"Failed to update roles for {member.display_name}: {e}")


def _now_str():
    """Timestamp string for match_history rows.

    Stored as TEXT ("YYYY-MM-DD HH:MM:SS") to match the column's
    CURRENT_TIMESTAMP default and the website's `timestamp.split(" ")` date
    parsing. Passing a raw `datetime` here would be serialized by libsql to
    int-milliseconds, which sorts/reads inconsistently against the TEXT values.
    """
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _append_match_log(match_log):
    with open("matches.log", "a") as f:
        f.write(json.dumps(match_log, indent=4) + "\n")


# Player columns that /rank and /ranktie can mutate — captured per row so
# /undolastmatch can restore a player's exact pre-match state.
_SNAPSHOT_COLS = [
    "elo", "rank", "matches_played", "matches_won", "peak_elo",
    "total_kills", "total_deaths", "total_assists", "total_mvps", "total_score",
    "total_headshot_percentage", "total_play_time", "avg_hs_percent", "kd_ratio",
    "placement_points", "placement_games_played", "placement_done",
    "glicko_rd", "glicko_vol", "last_played",
]


async def _capture_state(name):
    """Snapshot a player's mutable columns (pre-match) as a dict, or None if absent."""
    row = await db.fetchone(
        f"SELECT {', '.join(_SNAPSHOT_COLS)} FROM players WHERE name = ?", (name,)
    )
    return dict(zip(_SNAPSHOT_COLS, row)) if row else None


def _restore_state_stmt(name, state):
    """Build the (sql, params) UPDATE that restores a player's columns from a
    snapshot dict — so /undolastmatch can commit every restore in one batch."""
    cols = [c for c in _SNAPSHOT_COLS if c in state]
    return (
        f"UPDATE players SET {', '.join(f'{c} = ?' for c in cols)} WHERE name = ?",
        tuple(state[c] for c in cols) + (name,),
    )


async def _restore_state(name, state):
    """Restore a player's columns from a snapshot dict (used by /undolastmatch)."""
    sql, params = _restore_state_stmt(name, state)
    await db.execute(sql, params)


class RankingCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # Serializes match-mutating commands (/rank, /ranktie, /undolastmatch) so
        # concurrent invocations can't interleave their DB writes.
        self._match_lock = asyncio.Lock()
        # Last match_id handed out, to keep ids monotonic even when two matches
        # are recorded within the same wall-clock second.
        self._last_match_id = 0

    @app_commands.command(name="rank", description="Update player's Elo based on match results.")
    @app_commands.describe(
        scores="Per-player individual score (comma list, one per player). Drives Elo.",
        points="Team round score as winners,losers — e.g. 13,11 (the team with 13 won).",
    )
    async def rank(
        self,
        interaction: discord.Interaction,
        player_names: str,
        match_results: str,
        scores: str,
        points: str,
        kills: Optional[str] = None,
        deaths: Optional[str] = None,
        assists: Optional[str] = None,
        mvps: Optional[str] = None,
        hs: Optional[str] = None,
        map_name: Optional[str] = None,
        region: Optional[str] = None,
        play_time: Optional[str] = None,
    ):
        """Update Elo, handle placement matches, finalize rank, update Discord roles.

        ``scores`` is the per-player individual score (the performance metric that
        drives each player's Elo). ``points`` is the match-level team round score
        entered as ``winners,losers`` (e.g. ``13,11``) and is stored/displayed as
        the match scoreline; it does not change the Elo math.
        """
        await interaction.response.defer()
        if not has_required_role(interaction):
            await interaction.followup.send(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        try:
            names = [n.strip("@").strip() for n in _csv(player_names)]
            results = _csv(match_results)
            # Per-player individual score — the performance metric that drives Elo.
            score_vals = [int(x) for x in _csv(scores)]
            # Match-level team round score, entered as winners,losers (e.g. 13,11).
            round_tokens = [int(x) for x in _csv(points)]
            kills_vals = [int(x) for x in _csv(kills)] if kills else None
            deaths_vals = [int(x) for x in _csv(deaths)] if deaths else None
            assists_vals = [int(x) for x in _csv(assists)] if assists else None
            mvps_vals = [int(x) for x in _csv(mvps)] if mvps else None
            hs_vals = [float(x) for x in _csv(hs)] if hs else None
            # map_name / region / play_time are single match-level values (same for
            # every player), not per-player lists. play_time accepts "MM:SS" or seconds.
            map_name_val = _strip_quotes(map_name) if map_name else None
            region_val = _strip_quotes(region) if region else None
            play_time_seconds = _parse_play_time(play_time) if play_time else None

            if len(round_tokens) != 2:
                raise ValueError(
                    "points must be the team round score as two numbers 'winners,losers' "
                    f"(e.g. 13,11) — got {len(round_tokens)} value(s)"
                )
            round_score_str = f"{round_tokens[0]},{round_tokens[1]}"

            def check_len(lst, label):
                if lst is not None and len(lst) != len(names):
                    raise ValueError(
                        f"Length of {label} ({len(lst)}) does not match number of players ({len(names)})"
                    )

            # #1: the core lists must all match the player count (previously unchecked).
            check_len(results, "match_results")
            check_len(score_vals, "scores")
            for lst, label in [
                (kills_vals, "kills"), (deaths_vals, "deaths"), (assists_vals, "assists"),
                (mvps_vals, "mvps"), (hs_vals, "hs%"),
            ]:
                check_len(lst, label)
        except ValueError as ve:
            await interaction.followup.send(f"Invalid input: {ve}", ephemeral=True)
            return

        # #4: the active game profile declares which stat columns it uses. Warn (don't
        # block) if a profile-expected stat is missing, and note any provided that the
        # profile doesn't track. Maps profile stat keys -> /rank params.
        _stat_params = {
            "kills": kills, "deaths": deaths, "assists": assists,
            "mvps": mvps, "score": scores, "hs_percent": hs,
        }
        missing_expected = [s for s in GAME.stats if not _stat_params.get(s)]

        match_id = int(datetime.now().timestamp())
        match_log = {
            "match_id": match_id,
            "executed_by": interaction.user.name,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "details": [],
        }
        players_updated, players_not_found = [], []
        rank_changes = []   # (name, old_rank, new_rank) for announcements (#6)
        breakdowns = {}     # name -> {E, K, base, bonus} for the embed (#7)

        async with self._match_lock:
            # Assign the match id inside the lock so two matches recorded in the
            # same second get distinct, monotonically-increasing ids — otherwise
            # they'd share a match_id and /undolastmatch would reverse both.
            match_id = max(int(datetime.now().timestamp()), self._last_match_id + 1)
            self._last_match_id = match_id
            match_log["match_id"] = match_id

            # Opponent-aware models pre-compute per-side info from the lineup.
            #   team_expected -> each side's effective-Elo sum (for team avgs).
            #   glicko2       -> each side's list of (rating, RD) opponents.
            team_sum, team_count = {}, {}
            glicko_sides = {}
            win_label = GAME.win_label.upper()
            if GAME.elo.model in ("team_expected", "glicko2"):
                for name, result in zip(names, results):
                    row = await db.fetchone(
                        "SELECT elo, glicko_rd FROM players WHERE name = ?", (name,)
                    )
                    if not row:
                        continue
                    side = win_label if result.strip().upper() == win_label else "L"
                    if GAME.elo.model == "team_expected":
                        eff = row[0] if row[0] else GAME.elo.unranked_effective_elo
                        team_sum[side] = team_sum.get(side, 0) + eff
                        team_count[side] = team_count.get(side, 0) + 1
                    else:
                        rating = row[0] if row[0] else GAME.elo.unranked_effective_elo
                        rd = row[1] if row[1] else glicko2.DEFAULT_RD
                        glicko_sides.setdefault(side, []).append((rating, rd))

            def team_and_opp_avg(side, eff_self):
                """Average effective Elo of the player's team (excluding self) and the opponents."""
                opp = "L" if side == win_label else win_label
                own_n = team_count.get(side, 0) - 1
                own_avg = (team_sum.get(side, 0) - eff_self) / own_n if own_n > 0 else eff_self
                opp_n = team_count.get(opp, 0)
                opp_avg = team_sum.get(opp, 0) / opp_n if opp_n > 0 else eff_self
                return own_avg, opp_avg

            # Collect every write for the whole match and commit them in ONE
            # atomic db.batch at the end, so a mid-match error can't leave some
            # players' Elo changed with no matching history/undo row (which
            # /undolastmatch could never repair) or half the lineup updated.
            match_stmts = []
            placement_names = set()  # players still in placement this match (excluded from stats)
            for idx, (name, result, point) in enumerate(zip(names, results, score_vals)):
                snapshot = await _capture_state(name)
                if snapshot is None:
                    players_not_found.append(name)
                    continue
                current_elo = snapshot["elo"]
                current_rank = snapshot["rank"]
                placement_points = snapshot["placement_points"]
                games_played = snapshot["placement_games_played"]
                placement_done = snapshot["placement_done"]
                matches_played = snapshot["matches_played"]

                # Per-player stats (None when not provided) + match-level values.
                k = kills_vals[idx] if kills_vals is not None else None
                d = deaths_vals[idx] if deaths_vals is not None else None
                a = assists_vals[idx] if assists_vals is not None else None
                m = mvps_vals[idx] if mvps_vals is not None else None
                # The individual score is both the Elo driver (point) and the
                # per-player score stat accumulated into total_score.
                s = point
                hs_v = hs_vals[idx] if hs_vals is not None else None
                mp, rg, pt = map_name_val, region_val, play_time_seconds

                won_match = result.strip().upper() == win_label
                # Record the exact achievement increments applied (so undo can revert
                # them). Placement games don't count toward stats, so they apply — and
                # store — nothing; their empty dict makes undo revert no achievements.
                if placement_done:
                    ach_inc = {
                        "Matches Played Mastery": 1,
                        "Wins Mastery": 1 if won_match else 0,
                        "Points Mastery": point,
                        "Top Scorer Mastery": point,
                    }
                else:
                    ach_inc = {}
                undo_state = json.dumps({"p": snapshot, "ach": ach_inc})

                if placement_done:
                    new_glicko_rd = snapshot["glicko_rd"]
                    new_glicko_vol = snapshot["glicko_vol"]
                    if GAME.elo.model == "team_expected":
                        eff_self = current_elo if current_elo else GAME.elo.unranked_effective_elo
                        side = win_label if won_match else "L"
                        team_avg, opp_avg = team_and_opp_avg(side, eff_self)
                        new_elo, new_rank, bd = calculate_new_elo_team(
                            current_elo, won_match, point, team_avg, opp_avg, matches_played,
                            return_breakdown=True,
                        )
                        breakdowns[name] = bd
                    elif GAME.elo.model == "glicko2":
                        opp_side = "L" if won_match else win_label
                        score = 1.0 if won_match else 0.0
                        opponents = [(orat, ord_, score) for orat, ord_ in glicko_sides.get(opp_side, [])]
                        rd0 = glicko2.apply_decay(
                            snapshot["glicko_rd"], snapshot["glicko_vol"],
                            _inactivity_periods(snapshot["last_played"]),
                        )
                        rating = current_elo if current_elo else GAME.elo.unranked_effective_elo
                        new_rating, new_glicko_rd, new_glicko_vol = glicko2.update(
                            rating, rd0, snapshot["glicko_vol"], opponents, tau=GAME.elo.tau
                        )
                        new_elo = max(1, int(round(new_rating)))
                        new_rank = get_rank(new_elo)
                        breakdowns[name] = {"rd": f"{rd0:.0f}→{new_glicko_rd:.0f}"}
                    else:
                        new_elo, new_rank = calculate_new_elo(current_elo, won_match, point, player_name=name)
                    match_stmts.append((
                        """UPDATE players SET elo = ?, rank = ?, matches_played = matches_played + 1,
                           matches_won = matches_won + ?, peak_elo = MAX(peak_elo, ?),
                           glicko_rd = ?, glicko_vol = ?, last_played = ? WHERE name = ?""",
                        (new_elo, new_rank, 1 if won_match else 0, new_elo,
                         new_glicko_rd, new_glicko_vol, datetime.now().isoformat(), name),
                    ))
                    elo_change = new_elo - current_elo
                    players_updated.append((name, new_rank, new_elo, elo_change))
                    if new_rank != current_rank:
                        rank_changes.append((name, current_rank, new_rank))

                    if any(v is not None for v in (k, d, a, m, s, hs_v)):
                        update_parts, params = [], []
                        for col, val in [
                            ("total_kills", k), ("total_deaths", d), ("total_assists", a),
                            ("total_mvps", m), ("total_score", s),
                            ("total_headshot_percentage", hs_v), ("total_play_time", pt),
                        ]:
                            if val is not None:
                                update_parts.append(f"{col} = {col} + ?")
                                params.append(val)
                        if update_parts:
                            params.append(name)
                            match_stmts.append((
                                f"UPDATE players SET {', '.join(update_parts)} WHERE name = ?",
                                tuple(params),
                            ))

                    match_stmts.append((
                        """INSERT INTO match_history (player_name, elo_change, map_name, region,
                           kills, deaths, assists, hs_percentage, result, points, executed_by,
                           timestamp, mvps, match_id, round_score, undo_state, is_placement)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                        (name, elo_change, mp, rg, k, d, a, hs_v, result, point,
                         interaction.user.name, _now_str(), m, match_id, round_score_str, undo_state),
                    ))

                    detail = {"player_name": name, "previous_elo": current_elo, "new_elo": new_elo,
                              "result": result, "points": point, "rank": new_rank}
                    for key, val in [("kills", k), ("deaths", d), ("assists", a), ("mvps", m),
                                     ("score", s), ("hs_percentage", hs_v)]:
                        if val is not None:
                            detail[key] = val
                    match_log["details"].append(detail)

                    # avg_hs / kd are derived from the post-increment totals; compute
                    # them from the snapshot + this match's deltas instead of reading
                    # the row back, so they can join the same atomic batch.
                    if hs_v is not None:
                        new_total_hs = snapshot["total_headshot_percentage"] + hs_v
                        new_mp = matches_played + 1
                        avg_hs_value = (new_total_hs / new_mp) if new_mp > 0 else 0
                        match_stmts.append((
                            "UPDATE players SET avg_hs_percent = ? WHERE name = ?", (avg_hs_value, name)
                        ))

                    if k is not None and d is not None:
                        new_tk = snapshot["total_kills"] + k
                        new_td = snapshot["total_deaths"] + d
                        kd = round((new_tk / new_td) if new_td > 0 else new_tk, 3)
                        match_stmts.append((
                            "UPDATE players SET kd_ratio = ? WHERE name = ?", (kd, name)
                        ))
                else:
                    placement_names.add(name)  # placement game: excluded from stats/achievements
                    new_games_played = games_played + 1
                    new_total_points = placement_points + point
                    if new_games_played == 3:
                        final_rank = determine_rank(new_total_points / 3)
                        starting_elo = get_placement_elo(final_rank)
                        match_stmts.append((
                            """UPDATE players SET rank = ?, elo = ?, placement_points = 0,
                               placement_games_played = 0, placement_done = 1,
                               peak_elo = MAX(peak_elo, ?) WHERE name = ?""",
                            (final_rank, starting_elo, starting_elo, name),
                        ))
                        elo_change = starting_elo - current_elo
                        players_updated.append((name, final_rank, starting_elo, elo_change))
                        if final_rank != current_rank:
                            rank_changes.append((name, current_rank, final_rank))
                        match_log["details"].append(
                            {"player_name (placement_done)": name, "rank (3/3 placement)": final_rank}
                        )
                    else:
                        match_stmts.append((
                            "UPDATE players SET placement_points = ?, placement_games_played = ? WHERE name = ?",
                            (new_total_points, new_games_played, name),
                        ))
                        elo_change = 0
                        players_updated.append((name, "Placement Progress", new_games_played, None))
                        match_log["details"].append(
                            {"player_name (placement_progressing)": name, "placement_progress": new_games_played}
                        )
                    # Record a history row for placement players too, so /undolastmatch
                    # reverses the whole match (incl. placement progress + graduations).
                    # Flagged is_placement=1 so it's kept for undo but filtered out of
                    # every stat view — placement games don't count toward stats.
                    match_stmts.append((
                        """INSERT INTO match_history (player_name, elo_change, map_name, region,
                           kills, deaths, assists, hs_percentage, result, points, executed_by,
                           timestamp, mvps, match_id, round_score, undo_state, is_placement)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                        (name, elo_change, mp, rg, k, d, a, hs_v, result, point,
                         interaction.user.name, _now_str(), m, match_id, round_score_str, undo_state),
                    ))

            # Commit every collected write for this match atomically: each
            # player's Elo/stats update and their match_history (undo) row land
            # together or not at all — no half-applied matches.
            if match_stmts:
                await db.batch(match_stmts)

            # Achievements are applied inside the lock so they can't interleave
            # with a concurrent /undolastmatch reverting the same players. Placement
            # players are skipped — placement games don't count toward stats.
            for name, result, point in zip(names, results, score_vals):
                if name in players_not_found or name in placement_names:
                    continue
                await update_achievement_progress(name, "Matches Played Mastery", 1)
                if result.upper() == "W":
                    await update_achievement_progress(name, "Wins Mastery", 1)
                await update_achievement_progress(name, "Points Mastery", point)
                await update_achievement_progress(name, "Top Scorer Mastery", point)

        members = {m.display_name: m for m in interaction.guild.members}
        rank_roles = {r.name: r for r in interaction.guild.roles if r.name in _RANK_NAMES}
        for player_name, rank, elo_or_progress, _ in players_updated:
            new_rank = "[?] Unranked" if rank == "Placement Progress" else _rank_for_elo(elo_or_progress)
            member = members.get(player_name)
            if member:
                await _sync_member_rank_role(member, new_rank, rank_roles)

        _append_match_log(match_log)
        await self._send_results(
            interaction, "Match Results", "Updated Elo, Ranks, and Placement Progress",
            discord.Color.gold(), players_updated, players_not_found,
            rank_changes=rank_changes, breakdowns=breakdowns, missing_stats=missing_expected,
            match_id=match_id,
        )

    @app_commands.command(
        name="ranktie", description="Process a tie match - gives +10 Elo to all players involved."
    )
    async def rank_tie(
        self, interaction: discord.Interaction, player_names: str, points_for_unranked: str = None
    ):
        await interaction.response.defer()
        if not has_required_role(interaction):
            await interaction.followup.send(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        names = [n.strip("@").strip() for n in _csv(player_names)]
        if len(names) < 2:
            await interaction.followup.send(
                "At least 2 players are required for a tie match.", ephemeral=True
            )
            return

        placement_players = []
        async with self._match_lock:
            for name in names:
                row = await db.fetchone(
                    "SELECT placement_done FROM players WHERE name = ?", (name,)
                )
                if row and not row[0]:
                    placement_players.append(name)

        if placement_players:
            if points_for_unranked is None:
                await interaction.followup.send(
                    f"**Unranked players detected:** {', '.join(placement_players)}\n"
                    "Please provide points using `points_for_unranked: player1=points1, player2=points2`",
                    ephemeral=True,
                )
                return
            try:
                unranked_points = {}
                for entry in points_for_unranked.split(","):
                    pn, pts = entry.split("=")
                    unranked_points[pn.strip()] = int(pts.strip())
                missing = [p for p in placement_players if p not in unranked_points]
                if missing:
                    await interaction.followup.send(
                        f"Missing points for unranked players: {', '.join(missing)}", ephemeral=True
                    )
                    return
            except ValueError:
                await interaction.followup.send(
                    "Invalid points format. Use: `player1=points1, player2=points2`", ephemeral=True
                )
                return
        else:
            unranked_points = {}

        match_id = int(datetime.now().timestamp())
        match_log = {
            "match_id": match_id, "match_type": "tie",
            "executed_by": interaction.user.name,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "details": [],
        }
        players_updated, players_not_found = [], []
        rank_changes = []
        applied_achievements = []  # (name, tie_points) to apply once the batch lands

        async with self._match_lock:
            # Monotonic match_id (see /rank) so two ties in the same second get
            # distinct ids and /undolastmatch reverses only one.
            match_id = max(int(datetime.now().timestamp()), self._last_match_id + 1)
            self._last_match_id = match_id
            match_log["match_id"] = match_id

            # Collect all writes and commit them in ONE atomic db.batch so a
            # mid-loop error can't leave some players' Elo changed without their
            # matching undo row (or half the lineup updated).
            match_stmts = []
            for name in names:
                snapshot = await _capture_state(name)
                if snapshot is None:
                    players_not_found.append(name)
                    continue
                current_elo = snapshot["elo"]
                current_rank = snapshot["rank"]
                placement_points = snapshot["placement_points"]
                games_played = snapshot["placement_games_played"]
                placement_done = snapshot["placement_done"]

                # Achievement increments applied for ties (matches the updates below).
                # Placement games don't count toward stats, so they apply — and store
                # for undo — nothing.
                ach_points = unranked_points.get(name, 25)
                if placement_done:
                    ach_inc = {"Matches Played Mastery": 1, "Points Mastery": ach_points,
                               "Top Scorer Mastery": ach_points}
                else:
                    ach_inc = {}
                undo_state = json.dumps({"p": snapshot, "ach": ach_inc})

                if placement_done:
                    new_elo = current_elo + 10
                    new_rank = get_rank(new_elo)
                    match_stmts.append((
                        """UPDATE players SET elo = ?, rank = ?, matches_played = matches_played + 1,
                           peak_elo = MAX(peak_elo, ?) WHERE name = ?""",
                        (new_elo, new_rank, new_elo, name),
                    ))
                    players_updated.append((name, new_rank, new_elo, 10))
                    if new_rank != current_rank:
                        rank_changes.append((name, current_rank, new_rank))
                    elo_change, row_points = 10, 0
                    match_log["details"].append(
                        {"player_name": name, "previous_elo": current_elo, "new_elo": new_elo,
                         "result": "TIE", "elo_change": 10, "rank": new_rank}
                    )
                else:
                    new_games_played = games_played + 1
                    tie_points = unranked_points.get(name, get_tie_points(current_rank))
                    new_total_points = placement_points + tie_points
                    row_points = tie_points
                    if new_games_played == 3:
                        final_rank = determine_rank(new_total_points / 3)
                        starting_elo = get_placement_elo(final_rank)
                        match_stmts.append((
                            """UPDATE players SET rank = ?, elo = ?, placement_points = 0,
                               placement_games_played = 0, placement_done = 1,
                               peak_elo = MAX(peak_elo, ?) WHERE name = ?""",
                            (final_rank, starting_elo, starting_elo, name),
                        ))
                        elo_change = starting_elo - current_elo
                        players_updated.append((name, final_rank, starting_elo, elo_change))
                        if final_rank != current_rank:
                            rank_changes.append((name, current_rank, final_rank))
                        match_log["details"].append(
                            {"player_name (placement_done)": name,
                             "rank (3/3 placement)": final_rank, "result": "TIE"}
                        )
                    else:
                        match_stmts.append((
                            "UPDATE players SET placement_points = ?, placement_games_played = ? WHERE name = ?",
                            (new_total_points, new_games_played, name),
                        ))
                        elo_change = 0
                        players_updated.append((name, "Placement Progress", new_games_played, None))
                        match_log["details"].append(
                            {"player_name (placement_progressing)": name,
                             "placement_progress": new_games_played, "result": "TIE"}
                        )

                # is_placement=1 keeps the row for undo but filters it from stat views.
                match_stmts.append((
                    """INSERT INTO match_history (player_name, elo_change, result, points,
                       executed_by, timestamp, match_id, undo_state, is_placement)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (name, elo_change, "TIE", row_points, interaction.user.name,
                     _now_str(), match_id, undo_state, 0 if placement_done else 1),
                ))
                # Placement games don't count toward stats — only graduated players
                # accrue tie achievements.
                if placement_done:
                    applied_achievements.append((name, ach_points))

            if match_stmts:
                await db.batch(match_stmts)

            # Achievements are applied inside the lock so they can't interleave
            # with a concurrent /undolastmatch reverting the same players.
            for name, tie_points in applied_achievements:
                await update_achievement_progress(name, "Matches Played Mastery", 1)
                await update_achievement_progress(name, "Points Mastery", tie_points)
                await update_achievement_progress(name, "Top Scorer Mastery", tie_points)

        members = {m.display_name: m for m in interaction.guild.members}
        rank_roles = {r.name: r for r in interaction.guild.roles if r.name in _RANK_NAMES}
        for player_name, rank, elo_or_progress, _ in players_updated:
            if rank == "Placement Progress":
                continue
            new_rank = _rank_for_elo(elo_or_progress) if isinstance(elo_or_progress, (int, float)) else rank
            member = members.get(player_name)
            if member:
                await _sync_member_rank_role(member, new_rank, rank_roles)

        _append_match_log(match_log)
        await self._send_results(
            interaction, "Tie Match Results", "All players received +10 Elo",
            discord.Color.orange(), players_updated, players_not_found, rank_changes=rank_changes,
            match_id=match_id,
        )

    async def _send_results(self, interaction, title, description, color, players_updated,
                            players_not_found, rank_changes=None, breakdowns=None,
                            missing_stats=None, match_id=None):
        embed = discord.Embed(title=title, description=description, color=color)
        breakdowns = breakdowns or {}
        if match_id is not None:
            embed.set_footer(text=f"Match ID: {match_id}  ·  /undolastmatch {match_id} to reverse")
        for player_name, rank, elo_or_progress, elo_change in players_updated:
            if rank == "Placement Progress":
                embed.add_field(
                    name=f"{player_name} (Placement Match)",
                    value=f"Placement Matches Completed: {elo_or_progress}/3", inline=False,
                )
            elif rank != "None" and elo_or_progress != "None":
                change_text = ""
                if elo_change is not None:
                    sign = "+" if elo_change >= 0 else ""
                    change_text = f" ({sign}{elo_change})"
                value = f"Rank: {rank} | Elo: {elo_or_progress}{change_text}"
                # #7: show the team_expected breakdown so staff see *why* the delta happened.
                bd = breakdowns.get(player_name)
                if bd and bd.get("E") is not None:
                    value += f"\n_E={bd['E']} · K={bd['K']} · base={bd['base']:+} · bonus={bd['bonus']:+}_"
                elif bd and bd.get("rd"):
                    value += f"\n_RD {bd['rd']}_"
                embed.add_field(name=f"{player_name}", value=value, inline=False)

        # #6: rank-up / rank-down announcements.
        if rank_changes:
            lines = []
            for name, old_rank, new_rank in rank_changes:
                arrow = "⬆️" if _rank_index(new_rank) > _rank_index(old_rank) else "⬇️"
                lines.append(f"{arrow} **{name}**: {old_rank} → {new_rank}")
            embed.add_field(name="Rank Changes", value="\n".join(lines), inline=False)

        if players_not_found:
            embed.add_field(name="Players Not Found", value=", ".join(players_not_found), inline=False)
        if missing_stats:
            embed.add_field(
                name="⚠️ Note",
                value=f"This game's profile expects stats not provided: {', '.join(missing_stats)}",
                inline=False,
            )
        try:
            await refresh_top10_roles(self.bot)
        except Exception as e:
            logger.error(f"Failed to refresh TOP10 roles: {e}")
        await interaction.followup.send(embed=embed)

    @app_commands.command(
        name="undolastmatch",
        description="Reverse the most recent /rank match (or a given match_id). Match Staff only.",
    )
    async def undo_last_match(self, interaction: discord.Interaction, match_id: Optional[int] = None):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        await interaction.response.defer()

        win_label = GAME.win_label.upper()
        reversed_players = []
        ach_reverts = []  # applied after the transaction closes (own connections)
        async with self._match_lock:
            latest_row = await db.fetchone(
                "SELECT MAX(match_id) FROM match_history WHERE match_id IS NOT NULL"
            )
            latest_id = latest_row[0] if latest_row else None
            if match_id is None:
                if latest_id is None:
                    await interaction.followup.send(
                        "No reversible matches found.", ephemeral=True
                    )
                    return
                match_id = latest_id

            rows = await db.fetchall(
                """SELECT player_name, elo_change, kills, deaths, assists, hs_percentage,
                          points, mvps, result, undo_state
                   FROM match_history WHERE match_id = ?""",
                (match_id,),
            )
            if not rows:
                await interaction.followup.send(f"No match found with id `{match_id}`.", ephemeral=True)
                return

            # Exact (snapshot) restore is only safe for the most recent match — restoring
            # a snapshot for an older match would clobber later matches. Older/legacy rows
            # fall back to best-effort delta reversal.
            exact = match_id == latest_id

            # Collect every reversal write and the history delete, then commit
            # them in ONE atomic db.batch so an undo can't half-apply (some
            # players restored, others not, or the rows deleted without the
            # players reverted).
            undo_stmts = []
            for pname, elo_change, k, d, a, hs_v, points, m, result, undo_state in rows:
                prow = await db.fetchone("SELECT elo FROM players WHERE name = ?", (pname,))
                if not prow:
                    continue
                old_elo = prow[0]

                if exact and undo_state:
                    # Exact reversal: restore the full pre-match snapshot.
                    state = json.loads(undo_state)
                    undo_stmts.append(_restore_state_stmt(pname, state["p"]))
                    ach_reverts.append((pname, state.get("ach", {})))
                    new_elo = state["p"].get("elo", old_elo)
                else:
                    # Best-effort delta reversal (legacy rows or non-latest match).
                    new_elo = max(1, old_elo - (elo_change or 0))
                    won = (result or "").upper() == win_label
                    undo_stmts.append((
                        """UPDATE players SET
                           elo = ?, rank = ?,
                           matches_played = MAX(0, matches_played - 1),
                           matches_won = MAX(0, matches_won - ?),
                           total_kills = MAX(0, total_kills - ?),
                           total_deaths = MAX(0, total_deaths - ?),
                           total_assists = MAX(0, total_assists - ?),
                           total_mvps = MAX(0, total_mvps - ?),
                           total_score = MAX(0, total_score - ?),
                           total_headshot_percentage = MAX(0, total_headshot_percentage - ?)
                           WHERE name = ?""",
                        (new_elo, get_rank(new_elo), 1 if won else 0, k or 0, d or 0, a or 0,
                         m or 0, points or 0, hs_v or 0, pname),
                    ))
                reversed_players.append((pname, old_elo, new_elo))

            undo_stmts.append(("DELETE FROM match_history WHERE match_id = ?", (match_id,)))
            await db.batch(undo_stmts)

            # Apply achievement reverts inside the lock so they can't interleave
            # with a concurrent /rank or /ranktie touching the same players.
            for pname, ach in ach_reverts:
                for ach_name, inc in ach.items():
                    await revert_achievement_progress(pname, ach_name, inc)

        try:
            await refresh_top10_roles(self.bot)
        except Exception:
            pass

        embed = discord.Embed(
            title="Match Reversed",
            description=(
                f"Undid match `{match_id}` ({len(reversed_players)} players) — "
                + ("**exact** reversal." if exact else "best-effort (older match).")
            ),
            color=discord.Color.red(),
        )
        for pname, old_elo, new_elo in reversed_players[:25]:
            embed.add_field(name=pname, value=f"Elo {old_elo} → {new_elo}", inline=True)
        if exact:
            embed.set_footer(text="Fully reverted: Elo, rank, stats, achievements, peak Elo, placement.")
        else:
            embed.set_footer(
                text="Best-effort: Elo & stat totals reversed; achievements/peak/placement not "
                "restored (only the latest match can be reversed exactly)."
            )
        await interaction.followup.send(embed=embed)

    @app_commands.command(
        name="recentmatches", description="List recent matches and their IDs (Match Staff)."
    )
    async def recent_matches(self, interaction: discord.Interaction):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        rows = await db.fetchall(
            """SELECT match_id, MIN(timestamp), MAX(executed_by), MAX(map_name), COUNT(*)
               FROM match_history WHERE match_id IS NOT NULL
               GROUP BY match_id ORDER BY match_id DESC LIMIT 10"""
        )
        if not rows:
            await interaction.response.send_message("No matches recorded.", ephemeral=True)
            return
        embed = discord.Embed(title="Recent Matches", color=discord.Color.blue())
        for mid, ts, executor, mp, n in rows:
            embed.add_field(
                name=f"`{mid}`",
                value=f"{ts} · {mp or '—'} · {n} players · by {executor or '—'}",
                inline=False,
            )
        embed.set_footer(text="Reverse one with /undolastmatch <Match ID>")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(
        name="ocr2rank",
        description="Process a scoreboard image with OCR and output a ready-to-paste /rank command.",
    )
    async def ocr2rank(
        self,
        interaction: discord.Interaction,
        image_path: Optional[str] = None,
        image: Optional[discord.Attachment] = None,
    ):
        import asyncio
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        await interaction.response.defer()
        try:
            import finalocr
        except Exception as e:
            await interaction.followup.send(f"Failed to import OCR module: {e}", ephemeral=True)
            return

        temp_file = None
        try:
            if image is not None:
                import tempfile, time
                suffix = os.path.splitext(image.filename)[1] or ".png"
                temp_file = os.path.join(tempfile.gettempdir(), f"ocr_{int(time.time())}{suffix}")
                await image.save(temp_file)
                image_to_process = temp_file
            else:
                if not image_path:
                    await interaction.followup.send(
                        "Provide either an attachment or a valid image_path.", ephemeral=True
                    )
                    return
                image_to_process = image_path
            parsed = await asyncio.to_thread(finalocr.ocr_image_to_json, image_to_process)
        except Exception as e:
            msg = str(e)
            if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower():
                friendly = (
                    "⚠️ The OCR service is rate-limited or out of quota. Check the Gemini "
                    "key's billing/quota, or just enter the scoreboard with `/rank` manually."
                )
            else:
                friendly = f"OCR failed: {msg[:300]}"
            logger.error(f"ocr2rank failed: {msg}")
            await interaction.followup.send(friendly, ephemeral=True)
            return
        finally:
            try:
                if temp_file and os.path.exists(temp_file):
                    os.remove(temp_file)
            except Exception:
                pass

        def find_value(obj, keys, expect_type=None):
            if obj is None:
                return None
            if isinstance(obj, dict):
                for k, v in obj.items():
                    for key in keys:
                        if k and key and k.strip().lower() == key.strip().lower():
                            if expect_type is None or isinstance(v, expect_type):
                                return v
                for v in obj.values():
                    res = find_value(v, keys, expect_type)
                    if res is not None:
                        return res
            if isinstance(obj, list):
                for item in obj:
                    res = find_value(item, keys, expect_type)
                    if res is not None:
                        return res
            return None

        players = find_value(parsed, ["player_names", "Players", "Player", "players", "player"], list)
        kills = find_value(parsed, ["Kills", "K", "kills"], list)
        deaths = find_value(parsed, ["Deaths", "D", "deaths"], list)
        assists = find_value(parsed, ["Assists", "assists", "A"], list)
        mvps = find_value(parsed, ["MVP", "MVPs", "mvps", "Mvp"], list)
        hs = find_value(parsed, ["HS%", "HS", "hs", "Headshots"], list)
        score = find_value(parsed, ["match_points", "scores", "Score", "score", "Points"], list)
        won = find_value(parsed, ["match_results", "Won", "Result", "Results"], list)
        # Match-level scalar fields.
        map_name = find_value(parsed, ["map_name", "map", "Map"], str)
        region = find_value(parsed, ["region", "Region"], str)
        play_time = find_value(parsed, ["play_time", "playtime", "duration"], str)

        if not players:
            try:
                summary = (
                    {k: type(v).__name__ for k, v in parsed.items()}
                    if isinstance(parsed, dict) else {"root_type": type(parsed).__name__}
                )
                pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
            except Exception:
                summary, pretty = {}, str(parsed)
            await interaction.followup.send(
                f"OCR output did not contain a recognizable 'Players' list.\n"
                f"Top-level keys/types: {summary}\n\n```json\n{pretty[:1500]}\n```",
                ephemeral=True,
            )
            return

        def join_list(lst):
            return ",".join(str(x).strip() for x in lst) if lst else ""

        # No surrounding quotes — Discord slash fields are filled individually, and
        # stray quotes end up inside the values (breaking int parsing).
        parts = [f"player_names: {join_list(players)}"]
        for label, vals in [
            ("match_results", won), ("scores", score), ("kills", kills),
            ("deaths", deaths), ("assists", assists), ("mvps", mvps), ("hs", hs),
        ]:
            joined = join_list(vals)
            if joined:
                parts.append(f"{label}: {joined}")
        # points is the team round score (winners,losers) — OCR can't read it
        # reliably, so leave a placeholder for staff to fill in.
        parts.append("points: <winners,losers e.g. 13,11>")
        # Match-level scalars (single value for the whole match).
        for label, val in [("map_name", map_name), ("region", region), ("play_time", play_time)]:
            if val:
                parts.append(f"{label}: {str(val).strip()}")
        command_line = "/rank " + " ".join(parts)
        await interaction.followup.send(
            "Here is the generated /rank command (copy & paste into Discord).\n"
            "⚠️ `scores` is each player's individual score; set `points` to the "
            "team round score as `winners,losers` (e.g. `13,11`).\n\n"
            f"```\n{command_line}\n```"
        )

    @app_commands.command(name="addelo", description="Add Elo points to a player's current Elo.")
    async def add_elo(self, interaction: discord.Interaction, player_name: str, elo_to_add: int):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        current_elo = await get_player_elo(player_name)
        if current_elo is None:
            await interaction.response.send_message(
                f"Player '{player_name}' not found in the database.", ephemeral=True
            )
            return
        new_elo = min(current_elo + elo_to_add, 5000)
        await update_player_elo(player_name, new_elo)
        embed = discord.Embed(
            title="Elo Added",
            description=f"Added {elo_to_add} Elo to player '{player_name}'. New Elo: {new_elo} ({get_rank(new_elo)}).",
            color=discord.Color.gold(),
        )
        await interaction.response.send_message(embed=embed)

    @add_elo.autocomplete("player_name")
    async def _add_elo_ac(self, interaction: discord.Interaction, current: str):
        return await player_name_choices(current)

    @app_commands.command(name="removeelo", description="Remove Elo points from a player's current Elo.")
    async def remove_elo(self, interaction: discord.Interaction, player_name: str, elo_to_remove: int):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        current_elo = await get_player_elo(player_name)
        if current_elo is None:
            await interaction.response.send_message(
                f"Player '{player_name}' not found in the database.", ephemeral=True
            )
            return
        new_elo = max(current_elo - elo_to_remove, 0)
        await update_player_elo(player_name, new_elo)
        embed = discord.Embed(
            title="Elo Removed",
            description=f"Removed {elo_to_remove} Elo from player '{player_name}'. New Elo: {new_elo} ({get_rank(new_elo)}).",
            color=discord.Color.red(),
        )
        await interaction.response.send_message(embed=embed)

    @remove_elo.autocomplete("player_name")
    async def _remove_elo_ac(self, interaction: discord.Interaction, current: str):
        return await player_name_choices(current)

    @app_commands.command(
        name="refresh_top10", description="Refresh Top10 role assignments based on current Elo"
    )
    async def refresh_top10_command(self, interaction: discord.Interaction):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have permission to run this command.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True)
        await refresh_top10_roles(self.bot)
        await interaction.followup.send("Top10 roles refreshed.", ephemeral=True)

    @app_commands.command(
        name="update_roles", description="Sync rank + Top10 roles with database (Match Staff only)."
    )
    async def update_roles(self, interaction: discord.Interaction):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have permission to run this command.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            player_rows = await db.fetchall(
                "SELECT name, elo, rank, matches_won FROM players"
            )
            top_rows = await db.fetchall(
                "SELECT name, elo FROM players ORDER BY elo DESC, matches_won DESC LIMIT ?",
                (TOP10_COUNT,),
            )
            players = {r[0]: {"rank": r[2]} for r in player_rows}
            top_set = {r[0] for r in top_rows if r[1] >= TOP10_MIN_ELO}

            guild = interaction.guild
            top10_role = discord.utils.get(guild.roles, name=TOP10_ROLE_NAME)
            if top10_role is None:
                try:
                    top10_role = await guild.create_role(
                        name=TOP10_ROLE_NAME, reason="Auto-create Top10 role"
                    )
                except Exception:
                    logger.exception("Failed creating Top10 role")
                    await interaction.followup.send("Failed to create Top10 role.", ephemeral=True)
                    return

            existing_rank_roles = {r.name: r for r in guild.roles if r.name in _RANK_NAMES}
            added_rank = removed_rank = added_top = removed_top = 0

            async for member in guild.fetch_members(limit=None):
                if member.bot:
                    continue
                pdata = players.get(member.display_name)
                if not pdata:
                    continue
                desired_rank = pdata["rank"]
                if desired_rank not in existing_rank_roles:
                    try:
                        existing_rank_roles[desired_rank] = await guild.create_role(
                            name=desired_rank, reason="Create missing rank role"
                        )
                    except Exception:
                        logger.exception(f"Failed creating rank role {desired_rank}")
                        continue
                desired_role = existing_rank_roles.get(desired_rank)
                if desired_role and desired_role not in member.roles:
                    try:
                        await member.add_roles(desired_role, reason="Rank sync add")
                        added_rank += 1
                    except Exception:
                        logger.exception(f"Failed adding rank role to {member.display_name}")
                for rname, rrole in existing_rank_roles.items():
                    if rname != desired_rank and rrole in member.roles:
                        try:
                            await member.remove_roles(rrole, reason="Rank sync remove")
                            removed_rank += 1
                        except Exception:
                            logger.exception(f"Failed removing rank role from {member.display_name}")

                has_top = top10_role in member.roles
                should_have_top = member.display_name in top_set
                if should_have_top and not has_top:
                    try:
                        await member.add_roles(top10_role, reason="Top10 sync add")
                        added_top += 1
                    except Exception:
                        logger.exception(f"Failed adding Top10 role to {member.display_name}")
                elif not should_have_top and has_top:
                    try:
                        await member.remove_roles(top10_role, reason="Top10 sync remove")
                        removed_top += 1
                    except Exception:
                        logger.exception(f"Failed removing Top10 role from {member.display_name}")

            summary = (
                f"Rank roles added: {added_rank}\nRank roles removed: {removed_rank}\n"
                f"Top10 roles added: {added_top}\nTop10 roles removed: {removed_top}"
            )
            await interaction.followup.send(
                embed=discord.Embed(
                    title="Role Sync Complete", description=summary, color=discord.Color.blurple()
                ),
                ephemeral=True,
            )
        except Exception:
            logger.exception("Unexpected error in update_roles")
            await interaction.followup.send("An error occurred while syncing roles.", ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(RankingCog(bot))
