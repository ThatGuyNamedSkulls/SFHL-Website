"""Ranking commands: /rank, /ranktie, /ocr2rank, /addelo, /removeelo,
/refresh_top10, /update_roles.

Elo/rank/achievement logic comes from core.*; Top 10 maintenance from cogs.roles.
DB access uses core.db.connect (no shared global cursor).
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

from config.settings import TOP10_ROLE_NAME, TOP10_MIN_ELO, TOP10_COUNT
from core import db
from core.game_profile import ACTIVE as GAME
from core.ranks import RANK_THRESHOLDS, get_rank, determine_rank, get_placement_elo, get_tie_points
from core.elo import (
    calculate_new_elo,
    expectation_basis,
    mov_multiplier,
    placement_norm_factor,
    relative_perf_bonuses,
    rr_update,
    skill_share_bonuses,
    team_expected_update,
)
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
    UTC, because CURRENT_TIMESTAMP is UTC — local time would interleave wrongly
    with rows written via the column default.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


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
    "mmr", "placement_opp_sum",
]

# HL Coins awarded to every player in a completed match (/rank and /ranktie).
# Delta-reverted by /undolastmatch (recorded per row in undo_state["coins"]).
MATCH_COIN_REWARD = 100


async def _capture_state(name):
    """Snapshot a player's mutable columns (pre-match) as a dict, or None if absent."""
    row = await db.fetchone(
        f"SELECT {', '.join(_SNAPSHOT_COLS)} FROM players WHERE name = ?", (name,)
    )
    return dict(zip(_SNAPSHOT_COLS, row)) if row else None


def _restore_state_stmt(name, state, mode=None):
    """Build the (sql, params) UPDATE that restores a player's columns from a
    snapshot dict — so /undolastmatch can commit every restore in one batch.
    With ``mode`` set, the snapshot is an own-ladder mode_ratings row."""
    if mode:
        cols = [c for c in _MODE_SNAPSHOT_COLS if c in state]
        return (
            f"UPDATE mode_ratings SET {', '.join(f'{c} = ?' for c in cols)} "
            "WHERE player_name = ? AND mode = ?",
            tuple(state[c] for c in cols) + (name, mode),
        )
    cols = [c for c in _SNAPSHOT_COLS if c in state]
    return (
        f"UPDATE players SET {', '.join(f'{c} = ?' for c in cols)} WHERE name = ?",
        tuple(state[c] for c in cols) + (name,),
    )


async def _restore_state(name, state):
    """Restore a player's columns from a snapshot dict (used by /undolastmatch)."""
    sql, params = _restore_state_stmt(name, state)
    await db.execute(sql, params)


# Rating columns snapshotted for own-ladder gamemodes (a mode_ratings row
# instead of the players columns). Key names deliberately match their
# _SNAPSHOT_COLS counterparts so the rating logic reads either snapshot alike.
_MODE_SNAPSHOT_COLS = [
    "elo", "rank", "matches_played", "matches_won", "peak_elo",
    "placement_points", "placement_games_played", "placement_done",
    "placement_opp_sum", "glicko_rd", "glicko_vol", "mmr", "last_played",
]


async def _capture_mode_state(name, mode):
    """Snapshot (lazily creating) a player's own-ladder rating row for `mode`."""
    await db.execute(
        "INSERT OR IGNORE INTO mode_ratings (player_name, mode) VALUES (?, ?)",
        (name, mode),
    )
    row = await db.fetchone(
        f"SELECT {', '.join(_MODE_SNAPSHOT_COLS)} FROM mode_ratings "
        "WHERE player_name = ? AND mode = ?",
        (name, mode),
    )
    return dict(zip(_MODE_SNAPSHOT_COLS, row)) if row else None


async def _effective_skill(name, mode_label, own_ladder, model):
    """(eff, rd, placement_done) — the best estimate of a player's skill on the
    ladder this match moves, for the pre-pass (expectation basis, opponent
    averages, perf-bonus shares). Returns None when the player doesn't exist.

    Own-ladder modes read the mode_ratings row; a player's first games there
    (no rating yet) seed the estimate from their MAIN-ladder skill instead of a
    flat unranked value, so their 1v1 opponents' expectations stay honest.
    """
    row = await db.fetchone(
        "SELECT elo, glicko_rd, mmr, placement_done FROM players WHERE name = ?",
        (name,),
    )
    if not row:
        return None
    elo_v, rd_v, mmr_v, pdone = row[0], row[1], row[2], row[3]
    if mmr_v and (model == "mmr_rr" or not pdone):
        main_eff = mmr_v
    elif elo_v:
        main_eff = elo_v
    else:
        main_eff = GAME.elo.unranked_effective_elo
    if not own_ladder:
        return main_eff, (rd_v if rd_v else glicko2.DEFAULT_RD), pdone

    mrow = await db.fetchone(
        "SELECT elo, glicko_rd, mmr, placement_done FROM mode_ratings "
        "WHERE player_name = ? AND mode = ?",
        (name, mode_label),
    )
    m_elo, m_rd, m_mmr, m_pdone = (
        (mrow[0], mrow[1], mrow[2], mrow[3]) if mrow else (0, None, None, 0)
    )
    if m_mmr and (model == "mmr_rr" or not m_pdone):
        eff = m_mmr
    elif m_elo:
        eff = m_elo
    else:
        eff = main_eff  # first games on this ladder — seed from the main skill
    return eff, (m_rd if m_rd else glicko2.DEFAULT_RD), m_pdone


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
        mode="Gamemode; inferred from the lineup size (2⇒1v1, 4⇒2v2, 10⇒5v5) when omitted.",
    )
    @app_commands.choices(
        mode=[
            app_commands.Choice(name="5v5", value="5v5"),
            app_commands.Choice(name="2v2", value="2v2"),
            app_commands.Choice(name="1v1", value="1v1"),
        ]
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
        mode: Optional[str] = None,
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

        # Gamemode: inferred from the lineup size (2 ⇒ 1v1, 4 ⇒ 2v2, 10 ⇒ 5v5),
        # overridable via the mode param. Own-ladder modes (profile [modes],
        # e.g. 1v1) read/write a separate mode_ratings row — their own Elo,
        # MMR, rank and placements — leaving the main ladder untouched.
        mode_label = mode or GAME.mode_label_for_count(len(names))
        mode_cfg = GAME.mode_config(mode_label)
        own_ladder = mode_cfg.ladder == "own"
        placement_games = GAME.placement_games_for(mode_label)

        match_id = int(datetime.now().timestamp())
        match_log = {
            "match_id": match_id,
            "executed_by": interaction.user.name,
            "mode": mode_label,
            "timestamp": _now_str(),
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

            # Pre-compute per-side info from the lineup. Used by the opponent-
            # aware models (team_expected / glicko2 / mmr_rr), the zero-sum
            # relative perf bonus, and the placement opponent/MMR tracking.
            # Effective skill prefers the hidden MMR when it's the better
            # estimate (mmr_rr model, or a mid-placement player's soft MMR).
            team_sum, team_count = {}, {}
            side_players = {}  # side -> list of (name, eff, rd, score)
            win_label = GAME.win_label.upper()
            model = GAME.elo.model
            need_sides = (
                model in ("team_expected", "glicko2", "mmr_rr")
                or GAME.placement.use_mmr
                or GAME.placement.opp_weight > 0
                or GAME.placement.grade_mode == "normalized"
                or GAME.elo.perf_mode == "skill_share"
            )
            if need_sides:
                for name, result, point in zip(names, results, score_vals):
                    got = await _effective_skill(name, mode_label, own_ladder, model)
                    if got is None:
                        continue
                    eff, rd, _pdone = got
                    side = win_label if result.strip().upper() == win_label else "L"
                    team_sum[side] = team_sum.get(side, 0) + eff
                    team_count[side] = team_count.get(side, 0) + 1
                    side_players.setdefault(side, []).append((name, eff, rd, point))

            # The pre-pass skill estimate per player (ladder-aware, mmr-preferred)
            # — reused by the rating branches so expectations stay consistent.
            eff_of = {m[0]: m[1] for members in side_players.values() for m in members}

            # Zero-sum performance bonuses, re-centered per team:
            #   "relative"    — each score vs the team's raw mean.
            #   "skill_share" — each score vs the player's SKILL-WEIGHTED share
            #                   of the team total (mixed-lobby fair: a low-MMR
            #                   player is expected less, a high-MMR player more).
            bonus_map = {}
            if GAME.elo.perf_mode == "relative":
                for _side, members in side_players.items():
                    for (pname, _eff, _rd, _pt), b in zip(
                        members, relative_perf_bonuses([m[3] for m in members], GAME.elo)
                    ):
                        bonus_map[pname] = b
            elif GAME.elo.perf_mode == "skill_share":
                for _side, members in side_players.items():
                    for (pname, _eff, _rd, _pt), b in zip(
                        members,
                        skill_share_bonuses([(m[1], m[3]) for m in members], GAME.elo),
                    ):
                        bonus_map[pname] = b

            # Margin-of-victory multiplier from the team round score — the same
            # for both sides, so the K·(S−E) term stays zero-sum.
            mov = mov_multiplier(round_tokens[0], round_tokens[1], GAME.elo)

            def opp_side_of(side):
                return "L" if side == win_label else win_label

            def team_and_opp_avg(side, eff_self):
                """The player's expectation basis (per elo.e_basis: own skill /
                blend / teammates' average) and the opponents' average."""
                opp = opp_side_of(side)
                n = team_count.get(side, 0)
                own_excl = (team_sum.get(side, 0) - eff_self) / (n - 1) if n > 1 else eff_self
                own_incl = team_sum.get(side, 0) / n if n > 0 else eff_self
                opp_n = team_count.get(opp, 0)
                opp_avg = team_sum.get(opp, 0) / opp_n if opp_n > 0 else eff_self
                return expectation_basis(eff_self, own_incl, own_excl, GAME.elo), opp_avg

            def glicko_opponents(side, score_s):
                """(rating, rd, score) triples for everyone on the other side."""
                return [
                    (eff, rd, score_s)
                    for _n, eff, rd, _p in side_players.get(opp_side_of(side), [])
                ]

            def rating_upd(set_sql, params, name):
                """Rating UPDATE against the ladder this match moves: the
                players columns (main) or the player's mode_ratings row (own)."""
                if own_ladder:
                    return (
                        f"UPDATE mode_ratings SET {set_sql} WHERE player_name = ? AND mode = ?",
                        (*params, name, mode_label),
                    )
                return (f"UPDATE players SET {set_sql} WHERE name = ?", (*params, name))

            # Collect every write for the whole match and commit them in ONE
            # atomic db.batch at the end, so a mid-match error can't leave some
            # players' Elo changed with no matching history/undo row (which
            # /undolastmatch could never repair) or half the lineup updated.
            match_stmts = []
            placement_names = set()  # players still in placement this match (excluded from stats)
            for idx, (name, result, point) in enumerate(zip(names, results, score_vals)):
                main_snapshot = await _capture_state(name)
                if main_snapshot is None:
                    players_not_found.append(name)
                    continue
                # Own-ladder modes snapshot (and mutate) the mode_ratings row;
                # the key names match, so the rating logic below reads either.
                snapshot = (
                    await _capture_mode_state(name, mode_label) if own_ladder else main_snapshot
                )
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
                undo_state = json.dumps(
                    {
                        "p": snapshot, "ach": ach_inc, "coins": MATCH_COIN_REWARD,
                        "mode": mode_label if own_ladder else None,
                    }
                )
                # Every player in a completed match earns HL coins (delta-reverted
                # on exact /undolastmatch via the "coins" key recorded above).
                match_stmts.append(
                    ("UPDATE players SET coins = coins + ? WHERE name = ?",
                     (MATCH_COIN_REWARD, name))
                )

                if placement_done:
                    new_glicko_rd = snapshot["glicko_rd"]
                    new_glicko_vol = snapshot["glicko_vol"]
                    new_mmr = snapshot["mmr"]
                    side = win_label if won_match else "L"
                    S = 1.0 if won_match else 0.0
                    if model == "team_expected":
                        eff_self = eff_of.get(
                            name, current_elo if current_elo else GAME.elo.unranked_effective_elo
                        )
                        team_avg, opp_avg = team_and_opp_avg(side, eff_self)
                        new_elo, bd = team_expected_update(
                            current_elo, S, team_avg, opp_avg, matches_played,
                            mov_mult=mov, perf_bonus=bonus_map.get(name), point=point,
                        )
                        new_rank = get_rank(new_elo)
                        breakdowns[name] = bd
                    elif model == "mmr_rr":
                        # Hidden MMR takes the full opponent-aware update; the
                        # visible Elo then moves by a fixed base skewed toward
                        # the MMR (Valorant-style convergence). eff_of seeds a
                        # first own-ladder game from the main-ladder skill.
                        mmr0 = new_mmr if new_mmr else eff_of.get(
                            name,
                            current_elo if current_elo else GAME.elo.unranked_effective_elo,
                        )
                        team_avg, opp_avg = team_and_opp_avg(side, mmr0)
                        bonus = bonus_map.get(name)
                        if GAME.elo.perf_rank_cap is not None and _rank_index(
                            current_rank
                        ) >= _rank_index(GAME.elo.perf_rank_cap):
                            bonus = 0.0  # high ranks: pure win/loss
                        new_mmr, _bd = team_expected_update(
                            mmr0, S, team_avg, opp_avg, matches_played,
                            mov_mult=mov, perf_bonus=bonus, point=point,
                        )
                        base_elo = current_elo if current_elo else GAME.elo.unranked_effective_elo
                        rr = rr_update(base_elo, new_mmr, S, GAME.elo)
                        new_elo = max(1, int(round(base_elo + rr)))
                        new_rank = get_rank(new_elo)
                        # Show the APPLIED (rounded) RR so it always matches the
                        # Elo delta — the raw float can display one off (19.5 ⇒
                        # "+20" while round(elo+19.5) lands +19).
                        breakdowns[name] = {
                            "mmr": f"{int(mmr0)}→{int(new_mmr)}", "rr": new_elo - base_elo,
                        }
                    elif model == "glicko2":
                        opponents = glicko_opponents(side, S)
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
                    match_stmts.append(rating_upd(
                        """elo = ?, rank = ?, matches_played = matches_played + 1,
                           matches_won = matches_won + ?, peak_elo = MAX(peak_elo, ?),
                           glicko_rd = ?, glicko_vol = ?, mmr = ?, last_played = ?""",
                        (new_elo, new_rank, 1 if won_match else 0, new_elo,
                         new_glicko_rd, new_glicko_vol, new_mmr, datetime.now().isoformat()),
                        name,
                    ))
                    elo_change = new_elo - current_elo
                    players_updated.append((name, new_rank, new_elo, elo_change))
                    if new_rank != current_rank:
                        rank_changes.append((name, current_rank, new_rank))

                    # Aggregate stat columns describe the MAIN ladder — own-ladder
                    # matches (e.g. 1v1) keep their stats on the history rows only
                    # (filterable by the new mode column), so 1v1 K/D doesn't blend
                    # into the 5v5 profile numbers.
                    if not own_ladder and any(v is not None for v in (k, d, a, m, s, hs_v)):
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
                           timestamp, mvps, match_id, round_score, undo_state, is_placement, team, mode)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                        (name, elo_change, mp, rg, k, d, a, hs_v, result, point,
                         interaction.user.name, _now_str(), m, match_id, round_score_str, undo_state,
                         1 if won_match else 2, mode_label),
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
                    # the row back, so they can join the same atomic batch. Main
                    # ladder only (own-ladder matches don't touch aggregate stats).
                    if not own_ladder and hs_v is not None:
                        new_total_hs = snapshot["total_headshot_percentage"] + hs_v
                        new_mp = matches_played + 1
                        avg_hs_value = (new_total_hs / new_mp) if new_mp > 0 else 0
                        match_stmts.append((
                            "UPDATE players SET avg_hs_percent = ? WHERE name = ?", (avg_hs_value, name)
                        ))

                    if not own_ladder and k is not None and d is not None:
                        new_tk = snapshot["total_kills"] + k
                        new_td = snapshot["total_deaths"] + d
                        kd = round((new_tk / new_td) if new_td > 0 else new_tk, 3)
                        match_stmts.append((
                            "UPDATE players SET kd_ratio = ? WHERE name = ?", (kd, name)
                        ))
                else:
                    placement_names.add(name)  # placement game: excluded from stats/achievements
                    new_games_played = games_played + 1
                    side = win_label if won_match else "L"
                    # Lobby-normalized grading (placement.grade_mode "normalized"):
                    # the score is scaled by the player's skill-relative share of
                    # this lobby before hitting the placement bands, so scoring 30
                    # in a lobby above your level grades like scoring more in an
                    # even one. Still pure performance — wins never enter it.
                    soft_skill = eff_of.get(name) or GAME.elo.unranked_effective_elo
                    own_effs = [mem[1] for mem in side_players.get(side, [])]
                    lobby_effs = own_effs + [
                        mem[1] for mem in side_players.get(opp_side_of(side), [])
                    ]
                    norm = placement_norm_factor(
                        soft_skill, own_effs, lobby_effs, GAME.elo, GAME.placement
                    )
                    graded_point = round(point * norm, 1)
                    new_total_points = placement_points + graded_point
                    # Track average opponent skill per game — divided out at
                    # graduation to shift the starting Elo (placement.opp_*).
                    opp = opp_side_of(side)
                    opp_n = team_count.get(opp, 0)
                    opp_avg = (
                        team_sum.get(opp, 0) / opp_n if opp_n > 0
                        else GAME.elo.unranked_effective_elo
                    )
                    new_opp_sum = (snapshot["placement_opp_sum"] or 0) + opp_avg
                    # Soft hidden MMR (league decision): Glicko-2 vs the other
                    # side + the relative perf bonus. Never shown as the rank;
                    # makes balancing/expected-score honest mid-placement.
                    new_mmr = snapshot["mmr"]
                    new_glicko_rd = snapshot["glicko_rd"]
                    new_glicko_vol = snapshot["glicko_vol"]
                    if GAME.placement.use_mmr:
                        mmr0 = new_mmr if new_mmr else GAME.elo.unranked_effective_elo
                        rating, new_glicko_rd, new_glicko_vol = glicko2.update(
                            mmr0,
                            snapshot["glicko_rd"] or glicko2.DEFAULT_RD,
                            snapshot["glicko_vol"] or glicko2.DEFAULT_VOL,
                            glicko_opponents(side, 1.0 if won_match else 0.0),
                            tau=GAME.elo.tau,
                        )
                        new_mmr = max(1.0, rating + (bonus_map.get(name) or 0.0))
                    if new_games_played == placement_games:
                        # Graduation grade is PURE performance (avg graded score
                        # through the placement bands — wins never enter it),
                        # shifted by average opponent strength.
                        final_rank = determine_rank(new_total_points / placement_games)
                        starting_elo = get_placement_elo(final_rank)
                        if GAME.placement.opp_weight > 0:
                            avg_opp = new_opp_sum / placement_games
                            adj = GAME.placement.opp_weight * (
                                avg_opp - GAME.elo.unranked_effective_elo
                            )
                            adj = max(-GAME.placement.opp_cap, min(GAME.placement.opp_cap, adj))
                            starting_elo = max(1, int(round(starting_elo + adj)))
                        match_stmts.append(rating_upd(
                            """rank = ?, elo = ?, placement_points = 0,
                               placement_games_played = 0, placement_done = 1,
                               placement_opp_sum = 0, mmr = ?, glicko_rd = ?, glicko_vol = ?,
                               peak_elo = MAX(peak_elo, ?)""",
                            (final_rank, starting_elo, new_mmr, new_glicko_rd,
                             new_glicko_vol, starting_elo),
                            name,
                        ))
                        elo_change = starting_elo - current_elo
                        players_updated.append((name, final_rank, starting_elo, elo_change))
                        if final_rank != current_rank:
                            rank_changes.append((name, current_rank, final_rank))
                        match_log["details"].append(
                            {"player_name (placement_done)": name,
                             "rank (placement complete)": final_rank}
                        )
                    else:
                        match_stmts.append(rating_upd(
                            """placement_points = ?, placement_games_played = ?,
                               placement_opp_sum = ?, mmr = ?, glicko_rd = ?, glicko_vol = ?""",
                            (new_total_points, new_games_played, new_opp_sum,
                             new_mmr, new_glicko_rd, new_glicko_vol),
                            name,
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
                           timestamp, mvps, match_id, round_score, undo_state, is_placement, team, mode)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                        (name, elo_change, mp, rg, k, d, a, hs_v, result, point,
                         interaction.user.name, _now_str(), m, match_id, round_score_str, undo_state,
                         1 if won_match else 2, mode_label),
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
                if result.strip().upper() == win_label:
                    await update_achievement_progress(name, "Wins Mastery", 1)
                await update_achievement_progress(name, "Points Mastery", point)
                await update_achievement_progress(name, "Top Scorer Mastery", point)

        # Discord rank roles mirror the MAIN ladder only — an own-ladder (1v1)
        # rank never touches roles.
        if not own_ladder:
            members = {m.display_name: m for m in interaction.guild.members}
            rank_roles = {r.name: r for r in interaction.guild.roles if r.name in _RANK_NAMES}
            for player_name, rank, elo_or_progress, _ in players_updated:
                new_rank = "[?] Unranked" if rank == "Placement Progress" else _rank_for_elo(elo_or_progress)
                member = members.get(player_name)
                if member:
                    await _sync_member_rank_role(member, new_rank, rank_roles)

        _append_match_log(match_log)
        await self._send_results(
            interaction, f"Match Results ({mode_label})",
            "Updated Elo, Ranks, and Placement Progress",
            discord.Color.gold(), players_updated, players_not_found,
            rank_changes=rank_changes, breakdowns=breakdowns, missing_stats=missing_expected,
            match_id=match_id, placement_games=placement_games, sync_top10=not own_ladder,
        )

    @app_commands.command(
        name="ranktie",
        description="Process a tie match — opponent-aware Elo when teams are provided.",
    )
    @app_commands.describe(
        player_names="Comma list of the players in the match.",
        teams="Each player's team (1/2), aligned with player_names — e.g. 1,1,1,1,1,2,2,2,2,2.",
        scores="Per-player individual score, aligned with player_names (perf bonus + placement points).",
        points_for_unranked="Legacy: unranked points as player1=points1, ... (scores supersedes this).",
        mode="Gamemode; inferred from the lineup size (2⇒1v1, 4⇒2v2, 10⇒5v5) when omitted.",
    )
    @app_commands.choices(
        mode=[
            app_commands.Choice(name="5v5", value="5v5"),
            app_commands.Choice(name="2v2", value="2v2"),
            app_commands.Choice(name="1v1", value="1v1"),
        ]
    )
    async def rank_tie(
        self,
        interaction: discord.Interaction,
        player_names: str,
        teams: Optional[str] = None,
        scores: Optional[str] = None,
        points_for_unranked: Optional[str] = None,
        mode: Optional[str] = None,
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

        # teams: aligned 1/2 tokens — required for the opponent-aware tie math.
        team_of = None
        if teams is not None:
            team_tokens = _csv(teams)
            if len(team_tokens) != len(names) or any(t not in ("1", "2") for t in team_tokens):
                await interaction.followup.send(
                    "`teams` must be a comma list of 1/2 aligned with player_names "
                    "(e.g. `1,1,1,1,1,2,2,2,2,2`).",
                    ephemeral=True,
                )
                return
            if len(set(team_tokens)) < 2:
                await interaction.followup.send(
                    "`teams` must contain both team 1 and team 2.", ephemeral=True
                )
                return
            team_of = dict(zip(names, team_tokens))

        # scores: aligned per-player individual scores.
        score_of = {}
        if scores is not None:
            try:
                score_vals = [int(x) for x in _csv(scores)]
            except ValueError:
                await interaction.followup.send(
                    "`scores` must be a comma list of numbers aligned with player_names.",
                    ephemeral=True,
                )
                return
            if len(score_vals) != len(names):
                await interaction.followup.send(
                    f"Length of scores ({len(score_vals)}) does not match number of "
                    f"players ({len(names)}).",
                    ephemeral=True,
                )
                return
            score_of = dict(zip(names, score_vals))

        model = GAME.elo.model
        # Gamemode: inferred from the lineup size, overridable via the param.
        # Own-ladder modes (e.g. 1v1) move the mode_ratings row, not players.
        mode_label = mode or GAME.mode_label_for_count(len(names))
        mode_cfg = GAME.mode_config(mode_label)
        own_ladder = mode_cfg.ladder == "own"
        placement_games = GAME.placement_games_for(mode_label)
        # Opponent-aware tie (S=0.5 through the active model) needs the teams;
        # without them (or with tie_mode "flat") we fall back to legacy +10.
        expected_mode = (
            GAME.elo.tie_mode == "expected"
            and team_of is not None
            and model in ("team_expected", "glicko2", "mmr_rr")
        )
        flat_hint = GAME.elo.tie_mode == "expected" and team_of is None

        placement_players = []
        async with self._match_lock:
            for name in names:
                if own_ladder:
                    # Placement status lives on THIS mode's ladder: no row yet
                    # (or an unfinished one) means the player still places there.
                    if await db.fetchone(
                        "SELECT 1 FROM players WHERE name = ?", (name,)
                    ) is None:
                        continue
                    row = await db.fetchone(
                        "SELECT placement_done FROM mode_ratings "
                        "WHERE player_name = ? AND mode = ?",
                        (name, mode_label),
                    )
                    if not row or not row[0]:
                        placement_players.append(name)
                else:
                    row = await db.fetchone(
                        "SELECT placement_done FROM players WHERE name = ?", (name,)
                    )
                    if row and not row[0]:
                        placement_players.append(name)

        unranked_points = {}
        if placement_players:
            if points_for_unranked is not None:
                try:
                    for entry in points_for_unranked.split(","):
                        pn, pts = entry.split("=")
                        unranked_points[pn.strip()] = int(pts.strip())
                except ValueError:
                    await interaction.followup.send(
                        "Invalid points format. Use: `player1=points1, player2=points2`",
                        ephemeral=True,
                    )
                    return
            missing = [
                p for p in placement_players
                if p not in score_of and p not in unranked_points
            ]
            if missing:
                await interaction.followup.send(
                    f"**Unranked players detected:** {', '.join(missing)}\n"
                    "Provide their points via `scores` (aligned comma list) or "
                    "`points_for_unranked: player1=points1, player2=points2`.",
                    ephemeral=True,
                )
                return

        match_id = int(datetime.now().timestamp())
        match_log = {
            "match_id": match_id, "match_type": "tie",
            "executed_by": interaction.user.name,
            "timestamp": _now_str(), "details": [],
        }
        players_updated, players_not_found = [], []
        rank_changes = []
        breakdowns = {}
        applied_achievements = []  # (name, tie_points) to apply once the batch lands

        async with self._match_lock:
            # Monotonic match_id (see /rank) so two ties in the same second get
            # distinct ids and /undolastmatch reverses only one.
            match_id = max(int(datetime.now().timestamp()), self._last_match_id + 1)
            self._last_match_id = match_id
            match_log["match_id"] = match_id

            # Per-side pre-pass (mirrors /rank): effective skills, (rating, RD)
            # pairs, and the zero-sum relative perf bonuses — used by the
            # opponent-aware tie math and the placement opponent/MMR tracking.
            team_sum, team_count = {}, {}
            side_players = {}
            if team_of is not None:
                for name in names:
                    got = await _effective_skill(name, mode_label, own_ladder, model)
                    if got is None:
                        continue
                    eff, rd, _pdone = got
                    side = team_of[name]
                    team_sum[side] = team_sum.get(side, 0) + eff
                    team_count[side] = team_count.get(side, 0) + 1
                    side_players.setdefault(side, []).append(
                        (name, eff, rd, score_of.get(name))
                    )

            # Ladder-aware skill estimates, reused by the rating branches.
            eff_of = {m[0]: m[1] for members in side_players.values() for m in members}

            bonus_map = {}
            if expected_mode and score_of and GAME.elo.perf_mode in ("relative", "skill_share"):
                for _side, members in side_players.items():
                    scored = [m for m in members if m[3] is not None]
                    if GAME.elo.perf_mode == "relative":
                        bonuses = relative_perf_bonuses([m[3] for m in scored], GAME.elo)
                    else:
                        bonuses = skill_share_bonuses(
                            [(m[1], m[3]) for m in scored], GAME.elo
                        )
                    for (pname, _eff, _rd, _pt), b in zip(scored, bonuses):
                        bonus_map[pname] = b

            def opp_side_of(side):
                return "2" if side == "1" else "1"

            def team_and_opp_avg(side, eff_self):
                """Expectation basis (per elo.e_basis) and the opponents' average."""
                opp = opp_side_of(side)
                n = team_count.get(side, 0)
                own_excl = (team_sum.get(side, 0) - eff_self) / (n - 1) if n > 1 else eff_self
                own_incl = team_sum.get(side, 0) / n if n > 0 else eff_self
                opp_n = team_count.get(opp, 0)
                opp_avg = team_sum.get(opp, 0) / opp_n if opp_n > 0 else eff_self
                return expectation_basis(eff_self, own_incl, own_excl, GAME.elo), opp_avg

            def rating_upd(set_sql, params, name):
                """Rating UPDATE against the ladder this match moves."""
                if own_ladder:
                    return (
                        f"UPDATE mode_ratings SET {set_sql} WHERE player_name = ? AND mode = ?",
                        (*params, name, mode_label),
                    )
                return (f"UPDATE players SET {set_sql} WHERE name = ?", (*params, name))

            def glicko_opponents(side, score_s):
                return [
                    (eff, rd, score_s)
                    for _n, eff, rd, _p in side_players.get(opp_side_of(side), [])
                ]

            # Collect all writes and commit them in ONE atomic db.batch so a
            # mid-loop error can't leave some players' Elo changed without their
            # matching undo row (or half the lineup updated).
            match_stmts = []
            for name in names:
                main_snapshot = await _capture_state(name)
                if main_snapshot is None:
                    players_not_found.append(name)
                    continue
                snapshot = (
                    await _capture_mode_state(name, mode_label) if own_ladder else main_snapshot
                )
                current_elo = snapshot["elo"]
                current_rank = snapshot["rank"]
                placement_points = snapshot["placement_points"]
                games_played = snapshot["placement_games_played"]
                placement_done = snapshot["placement_done"]
                matches_played = snapshot["matches_played"]

                # Achievement increments applied for ties (matches the updates below).
                # Placement games don't count toward stats, so they apply — and store
                # for undo — nothing.
                ach_points = score_of.get(name, unranked_points.get(name, 25))
                if placement_done:
                    ach_inc = {"Matches Played Mastery": 1, "Points Mastery": ach_points,
                               "Top Scorer Mastery": ach_points}
                else:
                    ach_inc = {}
                undo_state = json.dumps(
                    {
                        "p": snapshot, "ach": ach_inc, "coins": MATCH_COIN_REWARD,
                        "mode": mode_label if own_ladder else None,
                    }
                )
                # Every player in a completed tie match also earns HL coins.
                match_stmts.append(
                    ("UPDATE players SET coins = coins + ? WHERE name = ?",
                     (MATCH_COIN_REWARD, name))
                )

                if placement_done:
                    new_glicko_rd = snapshot["glicko_rd"]
                    new_glicko_vol = snapshot["glicko_vol"]
                    new_mmr = snapshot["mmr"]
                    if expected_mode:
                        # Tie = S 0.5 through the active model: underdogs gain,
                        # favorites lose a little; ~zero-sum across the lobby.
                        side = team_of[name]
                        point = score_of.get(name)
                        if model == "team_expected":
                            eff_self = eff_of.get(
                                name,
                                current_elo if current_elo else GAME.elo.unranked_effective_elo,
                            )
                            team_avg, opp_avg = team_and_opp_avg(side, eff_self)
                            new_elo, bd = team_expected_update(
                                current_elo, 0.5, team_avg, opp_avg, matches_played,
                                perf_bonus=bonus_map.get(name), point=point,
                            )
                            new_rank = get_rank(new_elo)
                            breakdowns[name] = bd
                        elif model == "mmr_rr":
                            mmr0 = new_mmr if new_mmr else eff_of.get(
                                name,
                                current_elo if current_elo else GAME.elo.unranked_effective_elo,
                            )
                            team_avg, opp_avg = team_and_opp_avg(side, mmr0)
                            bonus = bonus_map.get(name)
                            if GAME.elo.perf_rank_cap is not None and _rank_index(
                                current_rank
                            ) >= _rank_index(GAME.elo.perf_rank_cap):
                                bonus = 0.0
                            new_mmr, _bd = team_expected_update(
                                mmr0, 0.5, team_avg, opp_avg, matches_played,
                                perf_bonus=bonus, point=point,
                            )
                            base_elo = current_elo if current_elo else GAME.elo.unranked_effective_elo
                            rr = rr_update(base_elo, new_mmr, 0.5, GAME.elo)
                            new_elo = max(1, int(round(base_elo + rr)))
                            new_rank = get_rank(new_elo)
                            # Applied (rounded) RR so the display matches the Elo delta.
                            breakdowns[name] = {
                                "mmr": f"{int(mmr0)}→{int(new_mmr)}", "rr": new_elo - base_elo,
                            }
                        else:  # glicko2 — draws are native (score 0.5)
                            rd0 = glicko2.apply_decay(
                                snapshot["glicko_rd"], snapshot["glicko_vol"],
                                _inactivity_periods(snapshot["last_played"]),
                            )
                            rating = current_elo if current_elo else GAME.elo.unranked_effective_elo
                            new_rating, new_glicko_rd, new_glicko_vol = glicko2.update(
                                rating, rd0, snapshot["glicko_vol"],
                                glicko_opponents(side, 0.5), tau=GAME.elo.tau,
                            )
                            new_elo = max(1, int(round(new_rating)))
                            new_rank = get_rank(new_elo)
                            breakdowns[name] = {"rd": f"{rd0:.0f}→{new_glicko_rd:.0f}"}
                    else:
                        # Legacy flat tie (+10): tie_mode "flat", or no teams given.
                        new_elo = current_elo + 10
                        new_rank = get_rank(new_elo)
                    elo_change = new_elo - current_elo
                    match_stmts.append(rating_upd(
                        """elo = ?, rank = ?, matches_played = matches_played + 1,
                           glicko_rd = ?, glicko_vol = ?, mmr = ?, last_played = ?,
                           peak_elo = MAX(peak_elo, ?)""",
                        (new_elo, new_rank, new_glicko_rd, new_glicko_vol, new_mmr,
                         datetime.now().isoformat(), new_elo),
                        name,
                    ))
                    players_updated.append((name, new_rank, new_elo, elo_change))
                    if new_rank != current_rank:
                        rank_changes.append((name, current_rank, new_rank))
                    row_points = score_of.get(name, 0)
                    match_log["details"].append(
                        {"player_name": name, "previous_elo": current_elo, "new_elo": new_elo,
                         "result": "TIE", "elo_change": elo_change, "rank": new_rank}
                    )
                else:
                    # Placement tie: pure performance points (never W/L), plus
                    # the opponent/soft-MMR tracking when teams are known.
                    new_games_played = games_played + 1
                    tie_points = score_of.get(
                        name, unranked_points.get(name, get_tie_points(current_rank))
                    )
                    row_points = tie_points
                    side = team_of.get(name) if team_of else None
                    # Lobby-normalized grading (same rule as /rank's placement
                    # branch); without teams the lobby is unknown -> factor 1.
                    if side is not None:
                        soft_skill = eff_of.get(name) or GAME.elo.unranked_effective_elo
                        own_effs = [mem[1] for mem in side_players.get(side, [])]
                        lobby_effs = own_effs + [
                            mem[1] for mem in side_players.get(opp_side_of(side), [])
                        ]
                        tie_points = round(
                            tie_points * placement_norm_factor(
                                soft_skill, own_effs, lobby_effs, GAME.elo, GAME.placement
                            ),
                            1,
                        )
                    new_total_points = placement_points + tie_points
                    if side is not None and team_count.get(opp_side_of(side), 0) > 0:
                        opp = opp_side_of(side)
                        opp_avg = team_sum.get(opp, 0) / team_count[opp]
                    else:
                        opp_avg = GAME.elo.unranked_effective_elo  # unknown -> neutral
                    new_opp_sum = (snapshot["placement_opp_sum"] or 0) + opp_avg
                    new_mmr = snapshot["mmr"]
                    new_glicko_rd = snapshot["glicko_rd"]
                    new_glicko_vol = snapshot["glicko_vol"]
                    if GAME.placement.use_mmr and side is not None:
                        mmr0 = new_mmr if new_mmr else GAME.elo.unranked_effective_elo
                        rating, new_glicko_rd, new_glicko_vol = glicko2.update(
                            mmr0,
                            snapshot["glicko_rd"] or glicko2.DEFAULT_RD,
                            snapshot["glicko_vol"] or glicko2.DEFAULT_VOL,
                            glicko_opponents(side, 0.5),
                            tau=GAME.elo.tau,
                        )
                        new_mmr = max(1.0, rating + (bonus_map.get(name) or 0.0))
                    if new_games_played == placement_games:
                        final_rank = determine_rank(new_total_points / placement_games)
                        starting_elo = get_placement_elo(final_rank)
                        if GAME.placement.opp_weight > 0:
                            avg_opp = new_opp_sum / placement_games
                            adj = GAME.placement.opp_weight * (
                                avg_opp - GAME.elo.unranked_effective_elo
                            )
                            adj = max(-GAME.placement.opp_cap, min(GAME.placement.opp_cap, adj))
                            starting_elo = max(1, int(round(starting_elo + adj)))
                        match_stmts.append(rating_upd(
                            """rank = ?, elo = ?, placement_points = 0,
                               placement_games_played = 0, placement_done = 1,
                               placement_opp_sum = 0, mmr = ?, glicko_rd = ?, glicko_vol = ?,
                               peak_elo = MAX(peak_elo, ?)""",
                            (final_rank, starting_elo, new_mmr, new_glicko_rd,
                             new_glicko_vol, starting_elo),
                            name,
                        ))
                        elo_change = starting_elo - current_elo
                        players_updated.append((name, final_rank, starting_elo, elo_change))
                        if final_rank != current_rank:
                            rank_changes.append((name, current_rank, final_rank))
                        match_log["details"].append(
                            {"player_name (placement_done)": name,
                             "rank (placement complete)": final_rank, "result": "TIE"}
                        )
                    else:
                        match_stmts.append(rating_upd(
                            """placement_points = ?, placement_games_played = ?,
                               placement_opp_sum = ?, mmr = ?, glicko_rd = ?, glicko_vol = ?""",
                            (new_total_points, new_games_played, new_opp_sum,
                             new_mmr, new_glicko_rd, new_glicko_vol),
                            name,
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
                       executed_by, timestamp, match_id, undo_state, is_placement, team, mode)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (name, elo_change, "TIE", row_points, interaction.user.name,
                     _now_str(), match_id, undo_state, 0 if placement_done else 1,
                     int(team_of[name]) if team_of else None, mode_label),
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

        # Discord rank roles mirror the MAIN ladder only.
        if not own_ladder:
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
        if expected_mode:
            description = (
                "Opponent-aware tie (S = 0.5): underdogs gain, favorites lose a little."
            )
        else:
            description = "All players received +10 Elo"
            if flat_hint:
                description += (
                    "\n💡 Provide `teams` (e.g. `1,1,1,1,1,2,2,2,2,2`) for "
                    "opponent-aware tie Elo."
                )
        await self._send_results(
            interaction, f"Tie Match Results ({mode_label})", description,
            discord.Color.orange(), players_updated, players_not_found, rank_changes=rank_changes,
            breakdowns=breakdowns, match_id=match_id,
            placement_games=placement_games, sync_top10=not own_ladder,
        )

    async def _send_results(self, interaction, title, description, color, players_updated,
                            players_not_found, rank_changes=None, breakdowns=None,
                            missing_stats=None, match_id=None, placement_games=None,
                            sync_top10=True):
        embed = discord.Embed(title=title, description=description, color=color)
        breakdowns = breakdowns or {}
        placement_games = placement_games or GAME.placement.games
        if match_id is not None:
            embed.set_footer(text=f"Match ID: {match_id}  ·  /undolastmatch {match_id} to reverse")
        for player_name, rank, elo_or_progress, elo_change in players_updated:
            if rank == "Placement Progress":
                embed.add_field(
                    name=f"{player_name} (Placement Match)",
                    value=f"Placement Matches Completed: {elo_or_progress}/{placement_games}",
                    inline=False,
                )
            elif rank != "None" and elo_or_progress != "None":
                change_text = ""
                if elo_change is not None:
                    sign = "+" if elo_change >= 0 else ""
                    change_text = f" ({sign}{elo_change})"
                value = f"Rank: {rank} | Elo: {elo_or_progress}{change_text}"
                # #7: show the model breakdown so staff see *why* the delta happened.
                bd = breakdowns.get(player_name)
                if bd and bd.get("E") is not None:
                    mov_txt = f" · mov=×{bd['mov']}" if bd.get("mov") and bd["mov"] != 1 else ""
                    value += (
                        f"\n_E={bd['E']} · K={bd['K']} · base={bd['base']:+} "
                        f"· bonus={bd['bonus']:+}{mov_txt}_"
                    )
                elif bd and bd.get("mmr"):
                    value += f"\n_MMR {bd['mmr']} · RR {bd['rr']:+.0f}_"
                elif bd and bd.get("rd"):
                    value += f"\n_RD {bd['rd']}_"
                embed.add_field(name=f"{player_name}", value=value, inline=False)

        # Every player in the match earns HL coins (see MATCH_COIN_REWARD).
        if players_updated:
            embed.add_field(
                name="🪙 HL Coins",
                value=f"+{MATCH_COIN_REWARD} to each of the {len(players_updated)} players in this match.",
                inline=False,
            )

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
        # Top-10 mirrors the MAIN ladder — own-ladder matches skip the refresh.
        if sync_top10:
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
                          points, mvps, result, undo_state, mode
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
            for pname, elo_change, k, d, a, hs_v, points, m, result, undo_state, row_mode in rows:
                # Which ladder did this match move? Exact rows record it in the
                # undo snapshot; older rows carry it on the history row itself.
                ladder_mode = None
                state = None
                if undo_state:
                    state = json.loads(undo_state)
                    ladder_mode = state.get("mode")
                if ladder_mode is None and row_mode and GAME.mode_config(row_mode).ladder == "own":
                    ladder_mode = row_mode

                if ladder_mode:
                    mrow = await db.fetchone(
                        "SELECT elo FROM mode_ratings WHERE player_name = ? AND mode = ?",
                        (pname, ladder_mode),
                    )
                    if not mrow:
                        continue
                    old_elo = mrow[0]
                else:
                    prow = await db.fetchone("SELECT elo FROM players WHERE name = ?", (pname,))
                    if not prow:
                        continue
                    old_elo = prow[0]

                if exact and state:
                    # Exact reversal: restore the full pre-match snapshot on the
                    # right ladder (players columns or the mode_ratings row).
                    undo_stmts.append(_restore_state_stmt(pname, state["p"], ladder_mode))
                    ach_reverts.append((pname, state.get("ach", {})))
                    # Coins are awarded per match but mutate outside the match flow
                    # (shop / /givecoins), so they're delta-reverted here rather than
                    # snapshot-restored (coins isn't a snapshot column).
                    coins_reward = state.get("coins", 0)
                    if coins_reward:
                        undo_stmts.append((
                            "UPDATE players SET coins = MAX(0, coins - ?) WHERE name = ?",
                            (coins_reward, pname),
                        ))
                    new_elo = state["p"].get("elo", old_elo)
                elif ladder_mode:
                    # Best-effort on an own-ladder row: revert the rating delta on
                    # the mode row (own-ladder matches never touch player stats).
                    new_elo = max(1, old_elo - (elo_change or 0))
                    undo_stmts.append((
                        """UPDATE mode_ratings SET elo = ?, rank = ?,
                           matches_played = MAX(0, matches_played - 1),
                           matches_won = MAX(0, matches_won - ?)
                           WHERE player_name = ? AND mode = ?""",
                        (new_elo, get_rank(new_elo),
                         1 if (result or "").upper() == win_label else 0, pname, ladder_mode),
                    ))
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
            # elo > 0: don't hand the Top 10 role out on a freshly-reset ladder.
            top_set = {r[0] for r in top_rows if r[1] >= TOP10_MIN_ELO and r[1] > 0}

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
