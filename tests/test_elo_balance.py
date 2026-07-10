"""Tests for the 2026-07 Elo balance overhaul.

Covers: the margin-of-victory multiplier, the zero-sum relative performance
bonus, opponent-aware ties (S=0.5), the mmr_rr visible-rating update, the
placement opponent-seed adjustment maths, and the config-default regression
guard (a profile without the new keys reproduces the old behavior).

    python -m pytest tests/test_elo_balance.py -q
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import elo  # noqa: E402
from core.game_profile import EloConfig, load_profile  # noqa: E402

_GAMES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "games"
)

CS = load_profile(os.path.join(_GAMES_DIR, "counterstrike.toml"))
VAL = load_profile(os.path.join(_GAMES_DIR, "valorant-style.toml"))


def _default_elo(**overrides):
    """An EloConfig with the pre-overhaul defaults (as an un-migrated profile)."""
    base = dict(
        base=20, win_min=5, win_max=30, loss_min=5, loss_max=30,
        overperform_ratio=1.7, underperform_ratio=0.5, unranked_effective_elo=1000,
    )
    base.update(overrides)
    return EloConfig(**base)


# --- margin of victory -------------------------------------------------------

def test_mov_disabled_by_default():
    e = _default_elo()
    assert elo.mov_multiplier(15, 0, e) == 1.0  # mov_weight defaults to 0


def test_mov_monotonic_and_clamped():
    e = _default_elo(mov_weight=0.35, max_rounds=15)
    assert elo.mov_multiplier(15, 14, e) == 1.0          # overtime-close: no boost
    mid = elo.mov_multiplier(15, 8, e)
    stomp = elo.mov_multiplier(15, 0, e)
    assert 1.0 < mid < stomp <= 1.35 + 1e-9              # monotonic in margin
    assert elo.mov_multiplier(None, None, e) == 1.0      # unusable rounds -> neutral


# --- zero-sum relative performance bonus -------------------------------------

def test_relative_bonus_zero_sum_and_direction():
    e = _default_elo(perf_mode="relative")
    scores = [60, 40, 30, 20, 10]
    bonuses = elo.relative_perf_bonuses(scores, e)
    assert abs(sum(bonuses)) < 1e-9                      # zero-sum per team
    assert bonuses[0] > 0 > bonuses[-1]                  # top scorer +, bottom -
    assert all(abs(b) <= 2 * e.perf_bonus_max for b in bonuses)


def test_relative_bonus_single_player_team():
    # 1v1: your performance IS the result — no bonus.
    assert elo.relative_perf_bonuses([50], _default_elo()) == [0.0]


# --- generalized team_expected update ----------------------------------------

def test_tie_direction_and_zero_sum():
    """S=0.5: the underdog gains, the favorite loses; equal teams move ~0."""
    under, _ = elo.team_expected_update(1000, 0.5, 1000, 1400, 50, CS, perf_bonus=0.0)
    fav, _ = elo.team_expected_update(1400, 0.5, 1400, 1000, 50, CS, perf_bonus=0.0)
    even, _ = elo.team_expected_update(1000, 0.5, 1000, 1000, 50, CS, perf_bonus=0.0)
    assert under > 1000            # tie vs stronger team gains
    assert fav < 1400              # tie vs weaker team loses
    assert even == 1000            # tie vs equals: no change


def test_win_reproduces_legacy_when_defaults():
    """mov=1 + legacy band bonus == the original calculate_new_elo_team."""
    new, _bd = elo.team_expected_update(1000, 1.0, 1000, 1000, 50, CS, point=24)
    assert new == 1012  # matches tests/test_elo_team.py's equal-teams case


def test_delta_cap():
    e = load_profile(os.path.join(_GAMES_DIR, "counterstrike.toml"))
    assert e.elo.delta_cap == 45
    # Beating a vastly stronger opponent as a new player with a max bonus would
    # exceed 45 uncapped (K=40 + 6) — the cap holds it.
    new, bd = elo.team_expected_update(
        1000, 1.0, 1000, 2400, 5, e, mov_mult=1.35, perf_bonus=6.0
    )
    assert new - 1000 <= 45


# --- mmr_rr visible-rating update ---------------------------------------------

def test_rr_convergence_direction():
    e = VAL.elo
    # MMR 100 above the visible Elo: wins pay more, losses cost less.
    assert elo.rr_update(1000, 1100, 1.0, e) > e.rr_base
    assert abs(elo.rr_update(1000, 1100, 0.0, e)) < e.rr_base
    # MMR below: the reverse.
    assert elo.rr_update(1000, 900, 1.0, e) < e.rr_base
    assert abs(elo.rr_update(1000, 900, 0.0, e)) > e.rr_base
    # Equilibrium: symmetric +/- rr_base.
    assert elo.rr_update(1000, 1000, 1.0, e) == e.rr_base
    assert elo.rr_update(1000, 1000, 0.0, e) == -e.rr_base


def test_rr_clamps_and_tie():
    e = VAL.elo
    assert elo.rr_update(1000, 2000, 1.0, e) == e.rr_max     # gain ceiling
    assert elo.rr_update(2000, 1000, 1.0, e) == e.rr_min     # gain floor
    # Tie: small move toward the MMR, capped.
    assert elo.rr_update(1000, 1030, 0.5, e) == 3.0
    assert elo.rr_update(1000, 2000, 0.5, e) == e.rr_tie_cap
    assert elo.rr_update(2000, 1000, 0.5, e) == -e.rr_tie_cap


# --- placement graduation seed maths ------------------------------------------

def test_placement_opp_adjustment_maths():
    p = CS.placement
    e = CS.elo
    assert p.opp_weight == 0.25 and p.use_mmr

    def seed_adjust(avg_opp):
        adj = p.opp_weight * (avg_opp - e.unranked_effective_elo)
        return max(-p.opp_cap, min(p.opp_cap, adj))

    assert seed_adjust(1000) == 0                      # neutral lobbies
    assert seed_adjust(1200) == 50                     # strong lobbies seed higher
    assert seed_adjust(1400) == p.opp_cap              # clamped at +75
    assert seed_adjust(600) == -p.opp_cap              # clamped at -75


# --- config-default regression guard ------------------------------------------

def test_unmigrated_profile_keeps_old_behavior():
    """An EloConfig without the new keys: MOV off, expected-band bonus, no cap."""
    e = _default_elo()
    assert e.tie_mode == "flat"
    assert e.mov_weight == 0.0
    assert e.perf_mode == "expected"
    assert e.delta_cap == 0.0
    assert elo.mov_multiplier(15, 0, e) == 1.0


def test_profiles_valid():
    assert CS.elo.tie_mode == "expected"
    assert VAL.elo.model == "mmr_rr"
    assert VAL.placement.games == 5
    assert VAL.elo.perf_rank_cap in {r.name for r in VAL.ranks}
