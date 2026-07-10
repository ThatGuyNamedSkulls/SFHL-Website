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


def expected_score(team_avg, opp_avg, e: EloConfig) -> float:
    """Standard Elo expected score of `team_avg` against `opp_avg`."""
    return 1.0 / (1.0 + 10 ** ((opp_avg - team_avg) / e.divisor))


def mov_multiplier(winner_rounds, loser_rounds, e: EloConfig) -> float:
    """Margin-of-victory multiplier on the K·(S−E) term, symmetric for both
    sides (so the term stays zero-sum). 15-14 ⇒ 1.0; a shutout ⇒ 1+mov_weight.
    Returns 1.0 when disabled (mov_weight 0) or the rounds are unusable."""
    if e.mov_weight <= 0 or winner_rounds is None or loser_rounds is None:
        return 1.0
    margin = winner_rounds - loser_rounds
    if margin <= 1:
        return 1.0
    mult = 1.0 + e.mov_weight * (margin - 1) / (e.max_rounds - 1)
    return min(1.0 + e.mov_weight, mult)


def expectation_basis(eff_self, team_avg_incl, team_avg_excl, e: EloConfig) -> float:
    """The rating whose expected score vs the opponents drives a player's
    win/loss term (MMR v2 mixed-lobby handling):

      "individual" — the player's OWN skill: a low-MMR player winning in a
                     high lobby is heavily compensated (E small), a high-MMR
                     player beating a weak lobby gains little (E large).
      "blend"      — e_blend·own + (1−e_blend)·team average (incl. self).
      "team"       — teammates' average excluding self (legacy behavior).
    """
    if e.e_basis == "individual":
        return eff_self
    if e.e_basis == "blend":
        return e.e_blend * eff_self + (1.0 - e.e_blend) * team_avg_incl
    return team_avg_excl


def _share_weights(effs, e: EloConfig) -> list:
    """Skill weights for expected-score shares: 10^(skill/perf_share_divisor).
    With the divisor at 2270 a 400-MMR gap ⇒ 1.5× expectation (1330 ⇒ 2×,
    4130 ⇒ 1.25×)."""
    return [10 ** (eff / e.perf_share_divisor) for eff in effs]


def skill_share_bonuses(members, e: EloConfig) -> list:
    """Per-player performance bonuses for ONE team (perf_mode "skill_share").

    ``members`` is [(eff_skill, score)]. Each player's EXPECTED score is their
    skill-weighted share of the team total — so a low-MMR player in a strong
    lobby is expected less and earns a positive bonus for merely keeping up,
    while a high-MMR player must outscore their higher expectation to break
    even. Re-centered per team so the bonuses sum to zero (no rating enters or
    leaves the pool). A single-player team gets 0 — in 1v1, performance IS the
    result."""
    n = len(members)
    if n < 2:
        return [0.0] * n
    total = sum(score for _eff, score in members)
    weights = _share_weights([eff for eff, _s in members], e)
    wsum = sum(weights)
    if total <= 0 or wsum <= 0:
        return [0.0] * n
    raw = []
    for (eff, score), w in zip(members, weights):
        expected = total * w / wsum
        spread = max(expected * e.perf_spread_ratio, 1.0)
        t = max(-1.0, min(1.0, (score - expected) / spread))
        raw.append(t * e.perf_bonus_max)
    center = sum(raw) / n
    return [r - center for r in raw]


def placement_norm_factor(eff_self, own_team_effs, lobby_effs, e: EloConfig, placement) -> float:
    """Lobby-strength normalization for a placement player's graded score
    (placement.grade_mode "normalized"): (equal share) / (their skill-weighted
    share), clamped to [norm_min, norm_max]. > 1 when the lobby outclasses them
    (their score is boosted before hitting the placement bands), < 1 when the
    lobby is beneath them.

    The share is computed within the player's own team (score shares across
    teams aren't comparable — losers score less); a solo team (1v1) falls back
    to the whole lobby, where the raw score really is opponent-conditioned.
    ``own_team_effs``/``lobby_effs`` must include the player themselves.
    """
    if placement.grade_mode != "normalized":
        return 1.0
    group = own_team_effs if len(own_team_effs) >= 2 else lobby_effs
    n = len(group)
    if n < 2:
        return 1.0
    weights = _share_weights(group, e)
    wsum = sum(weights)
    own_w = 10 ** (eff_self / e.perf_share_divisor)
    if wsum <= 0 or own_w <= 0:
        return 1.0
    factor = (1.0 / n) / (own_w / wsum)
    return max(placement.norm_min, min(placement.norm_max, factor))


def relative_perf_bonuses(scores, e: EloConfig) -> list:
    """Per-player performance bonuses for ONE team, from each player's score
    relative to the team's mean this match. Re-centered so they sum to zero
    (no rating enters or leaves the pool through the bonus). A single-player
    team gets 0 — in 1v1, performance IS the result."""
    n = len(scores)
    if n < 2:
        return [0.0] * n
    mean = sum(scores) / n
    spread = max(mean * e.perf_spread_ratio, 1.0)
    raw = [
        max(-1.0, min(1.0, (s - mean) / spread)) * e.perf_bonus_max for s in scores
    ]
    center = sum(raw) / n
    return [r - center for r in raw]


def team_expected_update(
    current_rating, score_s, team_avg, opp_avg, matches_played,
    profile=ACTIVE, mov_mult=1.0, perf_bonus=None, point=None,
):
    """Generalized team_expected update, shared by wins/losses AND ties (and the
    mmr_rr hidden track):

        delta = mov_mult · K · (S − E) + bonus,  clamped to ±delta_cap (if set)

    ``score_s`` is 1 (win), 0 (loss) or 0.5 (tie). ``perf_bonus`` is an explicit
    pre-computed bonus (the zero-sum relative mode); when None, the legacy
    expected-band bonus is derived from ``point`` (0 if that's None too).

    Returns (new_rating, breakdown dict {E, K, base, bonus, mov}).
    """
    e = profile.elo
    E = expected_score(team_avg, opp_avg, e)
    K = _dynamic_k(current_rating, matches_played, e)
    base_delta = mov_mult * K * (score_s - E)

    if perf_bonus is not None:
        bonus = perf_bonus
    elif point is not None:
        emin, emax = get_expected_range(get_rank(current_rating, profile), profile)
        expected_avg = (emin + emax) / 2
        bonus = _perf_t(point / expected_avg, e) * e.perf_bonus_max if expected_avg > 0 else 0.0
    else:
        bonus = 0.0

    delta = base_delta + bonus
    if e.delta_cap > 0:
        delta = max(-e.delta_cap, min(e.delta_cap, delta))
    new_rating = max(1, int(round(current_rating + delta)))
    breakdown = {
        "E": round(E, 3), "K": K, "base": round(base_delta, 1),
        "bonus": round(bonus, 1), "mov": round(mov_mult, 2),
    }
    return new_rating, breakdown


def rr_update(visible_elo, mmr_after, score_s, e: EloConfig) -> float:
    """Visible-rating (RR) delta for the mmr_rr model: a fixed base gain/loss
    skewed toward the hidden MMR (Valorant-style convergence). A tie moves the
    visible rating a little toward the MMR (±rr_tie_cap)."""
    gap = mmr_after - visible_elo
    if score_s == 0.5:
        return max(-e.rr_tie_cap, min(e.rr_tie_cap, e.conv_weight * gap))
    if score_s >= 1.0:
        return max(e.rr_min, min(e.rr_max, e.rr_base + e.conv_weight * gap))
    return -max(e.rr_min, min(e.rr_max, e.rr_base - e.conv_weight * gap))


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
        new_elo, breakdown = team_expected_update(
            current_elo, S, team_avg, opp_avg, matches_played, profile, point=point
        )
        logger.info(
            f"team_expected Elo: elo={current_elo} won={won_match} team_avg={team_avg:.0f} "
            f"opp_avg={opp_avg:.0f} E={breakdown['E']} K={breakdown['K']} "
            f"base={breakdown['base']} bonus={breakdown['bonus']} -> {new_elo}"
        )
        new_rank = get_rank(new_elo, profile)
        if return_breakdown:
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
