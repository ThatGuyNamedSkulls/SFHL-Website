"""Equivalence tests: the new core modules must reproduce the ORIGINAL behavior.

The original hardcoded tables/formulas are embedded here verbatim so we can
assert, across the full input ranges, that core.ranks and core.elo produce
identical results. Run from the project root:

    python tests/test_core.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import elo, ranks  # noqa: E402

# --------------------------------------------------------------------------
# ORIGINAL reference implementations (copied verbatim from the old main.py)
# --------------------------------------------------------------------------
ORIG_RANK_THRESHOLDS = [
    (0, 0, "[?] Unranked"),
    (1, 799, "[D | 1-799]"),
    (800, 949, "[C | 800-949]"),
    (950, 1099, "[B | 950-1099]"),
    (1100, 1249, "[A1 | 1100-1249]"),
    (1250, 1449, "[A2 | 1250-1449]"),
    (1450, 1649, "[A3 | 1450-1649]"),
    (1650, 1899, "[S1 | 1650-1899]"),
    (1900, 2199, "[S2 | 1900-2199]"),
    (2200, 2499, "[S3 | 2200-2499]"),
    (2500, 9999, "[★ | 2500+]"),
]

ORIG_PLACEMENT_RANKS = {
    (0, 10): "[D | 1-799]",
    (11, 20): "[C | 800-949]",
    (21, 27): "[B | 950-1099]",
    (28, 35): "[A1 | 1100-1249]",
    (36, 49): "[A2 | 1250-1449]",
    (50, 60): "[A3 | 1450-1649]",
    (61, float("inf")): "[S1 | 1650-1899]",
}

ORIG_RANK_EXPECTATIONS = {
    "[D | 1-799]": (0, 10),
    "[C | 800-949]": (11, 20),
    "[B | 950-1099]": (21, 27),
    "[A1 | 1100-1249]": (28, 35),
    "[A2 | 1250-1449]": (36, 43),
    "[A3 | 1450-1649]": (44, 50),
    "[S1 | 1650-1899]": (51, 55),
    "[S2 | 1900-2199]": (56, 60),
    "[S3 | 2200-2499]": (58, 62),
    "[★ | 2500+]": (62, 70),
}

ORIG_STARTING_ELO = {
    "[D | 1-799]": 650,
    "[C | 800-949]": 850,
    "[B | 950-1099]": 1000,
    "[A1 | 1100-1249]": 1175,
    "[A2 | 1250-1449]": 1325,
    "[A3 | 1450-1649]": 1500,
    "[S1 | 1650-1899]": 1750,
}


def orig_get_rank(e):
    for mn, mx, r in ORIG_RANK_THRESHOLDS:
        if mn <= e <= mx:
            return r
    return ORIG_RANK_THRESHOLDS[-1][2]


def orig_determine_rank(points_avg):
    rp = round(points_avg)
    for (low, high), rank in ORIG_PLACEMENT_RANKS.items():
        if low <= rp <= high:
            return rank
    return "[?] Unranked"


def orig_current_match_multiplier(current_points, current_elo):
    current_rank = orig_get_rank(current_elo)
    expected_min, expected_max = ORIG_RANK_EXPECTATIONS.get(current_rank, (20, 40))
    expected_avg = (expected_min + expected_max) / 2
    if expected_avg <= 0:
        return {"win": 20, "loss": -20}
    pr = current_points / expected_avg if expected_avg else 1.0
    if pr <= 0.5:
        t = -1.0
    elif pr >= 1.7:
        t = 1.0
    elif pr < 1.0:
        t = (pr - 1.0) / (1.0 - 0.5)
    else:
        t = (pr - 1.0) / (1.7 - 1.0)
    if t >= 0:
        win_change = 20 + t * (30 - 20)
    else:
        win_change = 20 + t * (20 - 5)
    if t >= 0:
        loss_mag = 20 - t * (20 - 5)
    else:
        loss_mag = 20 - t * (30 - 20)
    loss_change = -loss_mag
    win_change = max(5, min(30, win_change))
    loss_change = -max(5, min(30, abs(loss_change)))
    return {"win": round(win_change, 2), "loss": round(loss_change, 2)}


def orig_new_elo(current_elo, won, point):
    perf = orig_current_match_multiplier(point, current_elo)
    change = perf["win"] if won else perf["loss"]
    new_elo = max(1, int(round(current_elo + change)))
    return new_elo, orig_get_rank(new_elo)


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------
def check(label, condition):
    if not condition:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


def test_get_rank():
    for e in range(0, 11000):
        assert ranks.get_rank(e) == orig_get_rank(e), f"get_rank({e})"
    check("get_rank matches original for elo 0..11000", True)


def test_determine_rank():
    # Integer and half-step fractional averages (covers round() banker's rounding).
    for p10 in range(0, 2000):  # 0.0 .. 199.9 in 0.1 steps
        p = p10 / 10.0
        assert ranks.determine_rank(p) == orig_determine_rank(p), f"determine_rank({p})"
    check("determine_rank matches original for points 0.0..199.9", True)


def test_expected_range():
    for name, expected in ORIG_RANK_EXPECTATIONS.items():
        assert ranks.get_expected_range(name) == expected, f"expected_range({name})"
    # Unknown rank falls back to (20, 40).
    assert ranks.get_expected_range("[?] Unranked") == (20, 40)
    assert ranks.get_expected_range("nonexistent") == (20, 40)
    check("get_expected_range matches original (incl. fallback)", True)


def test_placement_elo():
    for name, e in ORIG_STARTING_ELO.items():
        assert ranks.get_placement_elo(name) == e, f"placement_elo({name})"
    assert ranks.get_placement_elo("[?] Unranked") == 1000
    check("get_placement_elo matches original starting_elo dict", True)


def test_match_multiplier_and_new_elo():
    sample_elos = list(range(0, 2700, 25))
    for current_elo in sample_elos:
        for points in range(0, 120):
            got = elo.calculate_current_match_multiplier(points, current_elo)
            exp = orig_current_match_multiplier(points, current_elo)
            assert got == exp, f"multiplier(points={points}, elo={current_elo}): {got} != {exp}"
            for won in (True, False):
                g = elo.calculate_new_elo(current_elo, won, points, player_name="x")
                e2 = orig_new_elo(current_elo, won, points)
                assert g == e2, f"new_elo(elo={current_elo}, won={won}, p={points}): {g} != {e2}"
    check("match multiplier + new_elo match original across elo/points grid", True)


def test_new_elo_no_player():
    for current_elo in range(0, 3000, 7):
        for won in (True, False):
            change = 20 if won else -20
            expect = max(1, int(round(current_elo + change)))
            got_elo, got_rank = elo.calculate_new_elo(current_elo, won, 30, player_name=None)
            assert got_elo == expect, f"flat new_elo(elo={current_elo}, won={won})"
            assert got_rank == orig_get_rank(expect)
    check("flat (no-player) new_elo matches original ±20 path", True)


if __name__ == "__main__":
    print("Running core equivalence tests...")
    test_get_rank()
    test_determine_rank()
    test_expected_range()
    test_placement_elo()
    test_match_multiplier_and_new_elo()
    test_new_elo_no_player()
    print("\nALL CORE EQUIVALENCE TESTS PASSED")
