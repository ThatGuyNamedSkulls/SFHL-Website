"""Validates core.glicko2 against the worked example in Glickman's paper
("Example of the Glicko-2 system"): player (1500, RD 200, vol 0.06), tau 0.5,
vs three opponents -> rating 1464.06, RD 151.52, vol 0.05999.

    python tests/test_glicko2.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import glicko2  # noqa: E402


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


def test_paper_reference():
    opponents = [
        (1400, 30, 1.0),
        (1550, 100, 0.0),
        (1700, 300, 0.0),
    ]
    r, rd, vol = glicko2.update(1500, 200, 0.06, opponents, tau=0.5)
    check(f"rating ~ 1464.06 (got {r:.2f})", abs(r - 1464.06) < 0.1)
    check(f"RD ~ 151.52 (got {rd:.2f})", abs(rd - 151.52) < 0.1)
    check(f"volatility ~ 0.05999 (got {vol:.5f})", abs(vol - 0.05999) < 0.0001)


def test_no_games_widens_rd():
    r, rd, vol = glicko2.update(1500, 200, 0.06, [])
    check("no games keeps rating, widens RD", r == 1500 and rd > 200 and vol == 0.06)


def test_decay_widens_rd():
    rd2 = glicko2.apply_decay(200, 0.06, periods=5)
    check("decay over 5 periods widens RD", rd2 > 200)
    check("decay is capped at DEFAULT_RD", glicko2.apply_decay(340, 0.06, periods=9999) <= glicko2.DEFAULT_RD)


def test_beating_stronger_gains_more():
    # Same player, win vs a strong confident opp gains more than vs a weak one.
    win_strong = glicko2.update(1500, 200, 0.06, [(1800, 50, 1.0)])[0]
    win_weak = glicko2.update(1500, 200, 0.06, [(1200, 50, 1.0)])[0]
    check("beating a stronger opponent gains more", win_strong > win_weak)


if __name__ == "__main__":
    print("Running Glicko-2 tests...")
    test_paper_reference()
    test_no_games_widens_rd()
    test_decay_widens_rd()
    test_beating_stronger_gains_more()
    print("\nALL GLICKO-2 TESTS PASSED")
