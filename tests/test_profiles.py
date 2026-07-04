"""Proves the bot is game-agnostic: rank/elo logic follows the active profile.

Loads both shipped profiles and checks that the same code paths produce
game-appropriate results. Run from the project root:

    python tests/test_profiles.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import ranks  # noqa: E402
from core.game_profile import load_profile  # noqa: E402

CS = load_profile(os.path.join("config", "games", "counterstrike.toml"))
VAL = load_profile(os.path.join("config", "games", "valorant.toml"))


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


def test_profiles_load_and_differ():
    check("CS name", CS.name == "Counter-Strike")
    check("Valorant name", VAL.name == "Valorant")
    check("different maps", set(CS.maps) != set(VAL.maps))
    check("different sides", CS.sides == ["CT", "T"] and VAL.sides == ["Attack", "Defense"])
    check("Valorant drops mvps stat", "mvps" not in VAL.stats and "mvps" in CS.stats)
    check("different win condition", CS.win_condition != VAL.win_condition)


def test_rank_logic_follows_profile():
    # Same Elo, different ladder -> different rank names.
    check("CS 1500 -> A3", ranks.get_rank(1500, CS) == "[A3 | 1450-1649]")
    check("Valorant 1500 -> Gold", ranks.get_rank(1500, VAL) == "Gold")
    check("CS unranked at 0", ranks.get_rank(0, CS) == "[?] Unranked")
    check("Valorant unranked at 0", ranks.get_rank(0, VAL) == "Unranked")
    check("Valorant top rank", ranks.get_rank(5000, VAL) == "Radiant")
    # Placement + expected ranges resolve per profile.
    check("Valorant placement avg 50 -> Platinum", ranks.determine_rank(50, VAL) == "Platinum")
    check("Valorant placement elo for Gold", ranks.get_placement_elo("Gold", VAL) == 1550)
    check("Valorant expected range Diamond", ranks.get_expected_range("Diamond", VAL) == (53, 62))


def test_validation_catches_bad_config():
    import tomllib  # noqa
    # A profile whose queue_size != team_size*2 must be rejected.
    bad = os.path.join("tests", "_bad_profile.toml")
    with open(bad, "w", encoding="utf-8") as f:
        f.write(CS_BAD)
    try:
        load_profile(bad)
    except ValueError:
        print("  ok: invalid profile rejected by validation")
    else:
        raise AssertionError("FAILED: invalid profile was NOT rejected")
    finally:
        os.remove(bad)


CS_BAD = """
[meta]
name = "Bad"
team_size = 5
queue_size = 7
[match]
win_label = "W"
loss_label = "L"
win_condition = "x"
[scoreboard]
stats = ["kills"]
[maps]
pool = ["A"]
sides = []
[elo]
base = 20
win_min = 5
win_max = 30
loss_min = 5
loss_max = 30
overperform_ratio = 1.7
underperform_ratio = 0.5
unranked_effective_elo = 1000
[unranked]
name = "Unranked"
elo_min = 0
elo_max = 0
[[ranks]]
name = "R1"
elo_min = 1
elo_max = 799
"""


if __name__ == "__main__":
    print("Running game-profile generalization tests...")
    test_profiles_load_and_differ()
    test_rank_logic_follows_profile()
    test_validation_catches_bad_config()
    print("\nALL PROFILE TESTS PASSED")
