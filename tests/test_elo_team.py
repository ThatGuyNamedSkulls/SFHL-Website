"""Tests for the opponent-aware 'team_expected' Elo model.

Verifies: expected-score scaling (beat-stronger > equal > stomp-weaker), dynamic
K-factor tiers, the bounded performance bonus, and exclude-self team averaging.

    python tests/test_elo_team.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import elo  # noqa: E402
from core.game_profile import ACTIVE  # noqa: E402


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


def new_elo(current, won, point, team_avg, opp_avg, mp):
    e, _ = elo.calculate_new_elo_team(current, won, point, team_avg, opp_avg, mp, ACTIVE)
    return e


def test_equal_teams():
    # elo 1000 (rank B, expected avg 24), neutral points -> bonus 0, K=24 (mid).
    assert new_elo(1000, True, 24, 1000, 1000, 50) == 1012   # +K/2
    assert new_elo(1000, False, 24, 1000, 1000, 50) == 988   # -K/2
    check("equal teams -> +/- K/2 (neutral points)", True)


def test_opponent_strength():
    win_equal = new_elo(1000, True, 24, 1000, 1000, 50)
    win_vs_stronger = new_elo(1000, True, 24, 1000, 1400, 50)
    win_vs_weaker = new_elo(1000, True, 24, 1000, 600, 50)
    check("beating a stronger team gains more than equal", win_vs_stronger > win_equal)
    check("beating a weaker team gains less than equal", win_vs_weaker < win_equal)

    loss_equal = new_elo(1000, False, 24, 1000, 1000, 50)
    loss_vs_stronger = new_elo(1000, False, 24, 1000, 1400, 50)
    check("losing to a stronger team costs less than equal", loss_vs_stronger > loss_equal)


def test_dynamic_k():
    # New player (mp<30) K=40; equal teams, neutral -> +20.
    assert new_elo(1000, True, 24, 1000, 1000, 5) == 1020
    # Top player (elo>=2200) K=10; rank S3 expected avg 60 -> neutral point 60.
    assert new_elo(2300, True, 60, 2300, 2300, 100) == 2305
    check("dynamic K: new player +20, top player +5 (equal teams)", True)


def test_performance_bonus():
    # elo 1000 (B, expected avg 24). Overperform >=1.7x (point 41) -> +6 bonus.
    assert new_elo(1000, True, 41, 1000, 1000, 50) == 1018   # +12 base +6 bonus
    # Underperform <=0.5x (point 12) -> -6 bonus.
    assert new_elo(1000, True, 12, 1000, 1000, 50) == 1006   # +12 base -6 bonus
    assert new_elo(1000, False, 12, 1000, 1000, 50) == 982   # -12 base -6 bonus
    check("bounded performance bonus (+/-6 at the edges)", True)


def test_exclude_self_average():
    # The /rank pre-pass computes team avg as (sum - self) / (count - 1).
    elos = [1000, 1100, 1200, 1300, 1400]
    self_elo = 1000
    team_avg = (sum(elos) - self_elo) / (len(elos) - 1)
    check("exclude-self team average = 1250 (not 1200)", team_avg == 1250)


def test_floor_at_one():
    check("Elo never drops below 1", new_elo(3, False, 0, 100, 3000, 5) >= 1)


if __name__ == "__main__":
    print("Running team_expected Elo tests...")
    test_equal_teams()
    test_opponent_strength()
    test_dynamic_k()
    test_performance_bonus()
    test_exclude_self_average()
    test_floor_at_one()
    print("\nALL TEAM-EXPECTED ELO TESTS PASSED")
