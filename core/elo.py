"""Elo / rating math, parameterized from the active game profile.

This preserves the original behavior exactly (the equivalence test in
tests/test_core.py checks every Elo value and points value), but the magic
numbers (base 20, edges at 0.5x/1.7x, 5..30 clamps) now come from the profile's
``[elo]`` section instead of being hardcoded.

The functions here are DB-free so they can be unit-tested in isolation.
``calculate_performance_multiplier`` takes the recent points list as an argument
rather than querying the database itself.
"""

import logging

from core.game_profile import ACTIVE, EloConfig
from core.ranks import get_expected_range, get_rank

logger = logging.getLogger(__name__)


def calculate_current_match_multiplier(current_points, current_elo, profile=ACTIVE):
    """Compute explicit win/loss Elo deltas based on this match's performance.

    Returns a dict ``{"win": <+delta>, "loss": <-delta>}`` clamped to the
    profile's win/loss bounds. Neutral performance returns +base/-base; strong
    over/under-performance pushes toward the configured edges.
    """
    try:
        e: EloConfig = profile.elo
        current_rank = get_rank(current_elo, profile)
        expected_min, expected_max = get_expected_range(current_rank, profile)
        expected_avg = (expected_min + expected_max) / 2

        if expected_avg <= 0:
            return {"win": e.base, "loss": -e.base}

        ratio = current_points / expected_avg if expected_avg else 1.0

        # Map ratio to t in [-1, 1]: -1 at underperform_ratio, 0 at 1.0x,
        # +1 at overperform_ratio.
        if ratio <= e.underperform_ratio:
            t = -1.0
        elif ratio >= e.overperform_ratio:
            t = 1.0
        elif ratio < 1.0:
            t = (ratio - 1.0) / (1.0 - e.underperform_ratio)
        else:
            t = (ratio - 1.0) / (e.overperform_ratio - 1.0)

        if t >= 0:
            win_change = e.base + t * (e.win_max - e.base)
            loss_mag = e.base - t * (e.base - e.loss_min)
        else:
            win_change = e.base + t * (e.base - e.win_min)
            loss_mag = e.base - t * (e.loss_max - e.base)

        loss_change = -loss_mag

        # Final safety clamps.
        win_change = max(e.win_min, min(e.win_max, win_change))
        loss_change = -max(e.loss_min, min(e.loss_max, abs(loss_change)))

        return {"win": round(win_change, 2), "loss": round(loss_change, 2)}
    except Exception as exc:
        logger.error(f"Error calculating current match multiplier: {exc}")
        return {"win": profile.elo.base, "loss": -profile.elo.base}


def calculate_new_elo(current_elo, won_match, point, player_name=None, profile=ACTIVE):
    """Return (new_elo, new_rank) after a match.

    With no ``player_name`` the legacy flat ±base change is used. Otherwise the
    per-match performance adjustment from
    :func:`calculate_current_match_multiplier` is applied.
    """
    base = profile.elo.base

    if not player_name:
        change = base if won_match else -base
        new_elo = max(1, int(round(current_elo + change)))
        return new_elo, get_rank(new_elo, profile)

    perf_adjust = calculate_current_match_multiplier(point, current_elo, profile)
    change = perf_adjust["win"] if won_match else perf_adjust["loss"]
    new_elo = current_elo + change
    logger.info(
        f"Per-match Elo adjustment for {player_name}: points={point}, "
        f"change={change} -> new Elo {new_elo}"
    )

    new_elo = max(1, int(round(new_elo)))
    return new_elo, get_rank(new_elo, profile)


def performance_ratio(current_points, current_elo, profile=ACTIVE):
    """Ratio of current points to the expected average for the player's rank."""
    try:
        current_rank = get_rank(current_elo, profile)
        expected_min, expected_max = get_expected_range(current_rank, profile)
        expected_avg = (expected_min + expected_max) / 2
        if expected_avg <= 0:
            return 1.0
        return current_points / expected_avg
    except Exception as exc:
        logger.error(f"Error calculating performance ratio: {exc}")
        return 1.0


def _perf_t(ratio, e: EloConfig):
    """Map a points/expected ratio to t in [-1, 1] (under -> -1, expected -> 0, over -> +1)."""
    if ratio <= e.underperform_ratio:
        return -1.0
    if ratio >= e.overperform_ratio:
        return 1.0
    if ratio < 1.0:
        return (ratio - 1.0) / (1.0 - e.underperform_ratio)
    return (ratio - 1.0) / (e.overperform_ratio - 1.0)


def _dynamic_k(current_elo, matches_played, e: EloConfig):
    """K-factor: new players move fast, top players slowly, everyone else in between."""
    if matches_played < e.k_new_games:
        return e.k_new
    if current_elo >= e.k_top_elo:
        return e.k_top
    return e.k_mid


def calculate_new_elo_team(
    current_elo, won_match, point, team_avg, opp_avg, matches_played,
    profile=ACTIVE, return_breakdown=False,
):
    """Opponent-aware Elo update (the ``team_expected`` model).

        delta = K * (S - E)  +  bounded performance bonus
          S = 1 (win) or 0 (loss)
          E = expected win probability from the team Elo difference
              (``team_avg`` should EXCLUDE the player themselves)
          K = dynamic K-factor (new players faster, top players slower)

    Returns (new_elo, new_rank); with ``return_breakdown=True`` also returns a
    third element: a dict ``{E, K, base, bonus}`` for display.
    """
    e = profile.elo
    try:
        S = 1.0 if won_match else 0.0
        E = 1.0 / (1.0 + 10 ** ((opp_avg - team_avg) / e.divisor))
        K = _dynamic_k(current_elo, matches_played, e)
        base_delta = K * (S - E)

        # Small performance bonus from this match's points vs the rank's expectation.
        emin, emax = get_expected_range(get_rank(current_elo, profile), profile)
        expected_avg = (emin + emax) / 2
        bonus = _perf_t(point / expected_avg, e) * e.perf_bonus_max if expected_avg > 0 else 0.0

        new_elo = max(1, int(round(current_elo + base_delta + bonus)))
        logger.info(
            f"team_expected Elo: elo={current_elo} won={won_match} team_avg={team_avg:.0f} "
            f"opp_avg={opp_avg:.0f} E={E:.3f} K={K} base={base_delta:.1f} bonus={bonus:.1f} -> {new_elo}"
        )
        new_rank = get_rank(new_elo, profile)
        if return_breakdown:
            breakdown = {"E": round(E, 3), "K": K, "base": round(base_delta, 1), "bonus": round(bonus, 1)}
            return new_elo, new_rank, breakdown
        return new_elo, new_rank
    except Exception as exc:
        logger.error(f"Error in team_expected Elo: {exc}")
        change = e.base if won_match else -e.base
        new_elo = max(1, int(round(current_elo + change)))
        new_rank = get_rank(new_elo, profile)
        if return_breakdown:
            return new_elo, new_rank, {"E": None, "K": None, "base": change, "bonus": 0}
        return new_elo, new_rank


def calculate_performance_multiplier(recent_points, current_elo, profile=ACTIVE):
    """Multiplier (used by /checkperformance) from a player's recent points.

    ``recent_points`` is the list of points from the player's last games (the
    caller fetches it from the DB). Needs >= 3 games or returns 1.0. Mirrors the
    original thresholds: 1.5 / 1.25 / 1.0 / 0.85 / 0.7.
    """
    try:
        if len(recent_points) < 3:
            return 1.0

        avg_recent_points = sum(recent_points) / len(recent_points)
        current_rank = get_rank(current_elo, profile)
        expected_min, expected_max = get_expected_range(current_rank, profile)
        expected_avg = (expected_min + expected_max) / 2
        ratio = avg_recent_points / expected_avg

        if ratio < 0.7:
            return 1.5
        elif ratio < 0.85:
            return 1.25
        elif ratio > 1.3:
            return 0.7
        elif ratio > 1.15:
            return 0.85
        return 1.0
    except Exception as exc:
        logger.error(f"Error calculating performance multiplier: {exc}")
        return 1.0
