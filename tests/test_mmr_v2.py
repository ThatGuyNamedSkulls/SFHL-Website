"""MMR v2 tests: individual expectations, skill-share bonuses, lobby-normalized
placement grading, per-mode config, and the own-ladder (1v1) integration flow.

The math tests are pure (no DB). The integration test drives the REAL /rank +
/undolastmatch against a local libsql file DB with the 1v1 mode mapped to its
own ladder, and asserts the main ladder never moves.

    python tests/test_mmr_v2.py
"""

import asyncio
import dataclasses
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = os.path.join(tempfile.gettempdir(), f"mmrv2_{os.getpid()}.db")
os.environ.setdefault("TURSO_DATABASE_URL", "file:" + DB.replace("\\", "/"))

from core.elo import (  # noqa: E402
    expectation_basis,
    expected_score,
    placement_norm_factor,
    skill_share_bonuses,
)
from core.game_profile import (  # noqa: E402
    ACTIVE,
    EloConfig,
    ModeConfig,
    PlacementConfig,
    _validate,
    load_profile,
)

_GAMES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "games"
)
CS = load_profile(os.path.join(_GAMES, "counterstrike.toml"))


def _elo(**kw) -> EloConfig:
    """An EloConfig with sane test values, overridable per test."""
    base = dict(
        base=20, win_min=5, win_max=30, loss_min=5, loss_max=30,
        overperform_ratio=1.7, underperform_ratio=0.5, unranked_effective_elo=1000,
        model="team_expected",
    )
    base.update(kw)
    return EloConfig(**base)


# --- expectation basis (win/loss E in mixed lobbies) -------------------------

def test_e_basis_individual_uses_own_skill():
    e = _elo(e_basis="individual")
    assert expectation_basis(900, 1400, 1500, e) == 900
    # A 900 player facing a 1400 lobby: E must be tiny -> big win payout.
    E = expected_score(expectation_basis(900, 1400, 1500, e), 1400, e)
    assert E < 0.1


def test_e_basis_blend_and_team():
    e = _elo(e_basis="blend", e_blend=0.5)
    assert expectation_basis(900, 1400, 1500, e) == pytest.approx(1150)
    e = _elo(e_basis="team")
    assert expectation_basis(900, 1400, 1500, e) == 1500  # legacy: excl-self avg


def test_e_basis_compensation_direction():
    """Individual E: the underdog's win pays more than the favorite's."""
    e = _elo(e_basis="individual")
    opp = 1400
    e_low = expected_score(expectation_basis(900, opp, opp, e), opp, e)
    e_high = expected_score(expectation_basis(1700, opp, opp, e), opp, e)
    assert e_low < 0.5 < e_high  # low-MMR gains (1-E) more on a win


# --- skill-share performance bonus -------------------------------------------

def test_skill_share_zero_sum_and_direction():
    e = _elo(perf_mode="skill_share", perf_share_divisor=2270.0)
    # 900 / 1300 / 1300 team, everyone scoring the raw mean (35).
    members = [(900, 35), (1300, 35), (1300, 35)]
    bonuses = skill_share_bonuses(members, e)
    assert sum(bonuses) == pytest.approx(0.0)
    # The 900 outperformed THEIR (lower) expectation -> positive bonus; the
    # 1300s underperformed theirs -> negative.
    assert bonuses[0] > 0 > bonuses[1]


def test_skill_share_single_player_team_is_zero():
    e = _elo(perf_mode="skill_share")
    assert skill_share_bonuses([(1400, 50)], e) == [0.0]


def test_skill_share_divisor_anchor():
    """The documented anchor: divisor 2270 ⇒ a 400-gap pair expects ~1.5x."""
    e = _elo(perf_share_divisor=2270.0)
    w_low, w_high = 10 ** (1000 / 2270.0), 10 ** (1400 / 2270.0)
    assert w_high / w_low == pytest.approx(1.5, abs=0.01)


# --- lobby-normalized placement grading ---------------------------------------

def test_norm_factor_raw_mode_is_one():
    p = PlacementConfig(grade_mode="raw")
    assert placement_norm_factor(1000, [1000, 1400], [1000, 1400], _elo(), p) == 1.0


def test_norm_factor_boosts_in_stronger_lobby():
    p = PlacementConfig(grade_mode="normalized")
    e = _elo()
    # Soft-1000 placement player among 1400s: expected share < equal share.
    f = placement_norm_factor(1000, [1000, 1400, 1400, 1400, 1400], [], e, p)
    assert 1.0 < f <= p.norm_max
    # Equal lobby -> no adjustment.
    assert placement_norm_factor(1000, [1000, 1000, 1000], [], e, p) == pytest.approx(1.0)
    # Player ABOVE the lobby -> discounted.
    assert placement_norm_factor(1600, [1600, 1000, 1000], [], e, p) < 1.0


def test_norm_factor_clamps_and_1v1_fallback():
    p = PlacementConfig(grade_mode="normalized", norm_min=0.6, norm_max=1.8)
    e = _elo()
    # Extreme lobby hits the clamp.
    f = placement_norm_factor(200, [200, 2500, 2500, 2500, 2500], [], e, p)
    assert f == p.norm_max
    # 1v1: own team is solo -> falls back to the whole lobby (the opponent).
    f = placement_norm_factor(1000, [1000], [1000, 1400], e, p)
    assert f > 1.0


# --- config / modes ------------------------------------------------------------

def test_defaults_preserve_prior_behavior():
    """A profile without the new keys stays on the legacy math everywhere."""
    assert CS.elo.e_basis == "team"
    assert CS.placement.grade_mode == "raw"
    assert CS.modes == {}
    assert CS.mode_config("1v1").ladder == "main"
    assert CS.placement_games_for("1v1") == CS.placement.games


def test_mode_label_inference():
    assert CS.mode_label_for_count(2) == "1v1"
    assert CS.mode_label_for_count(4) == "2v2"
    assert CS.mode_label_for_count(10) == "5v5"
    # Odd / unknown sizes fall back to the configured team size.
    assert CS.mode_label_for_count(7) == f"{CS.team_size}v{CS.team_size}"


def test_validation_rejects_bad_values():
    with pytest.raises(ValueError):
        _validate(dataclasses.replace(CS, elo=dataclasses.replace(CS.elo, e_basis="nope")))
    with pytest.raises(ValueError):
        _validate(dataclasses.replace(
            CS, placement=dataclasses.replace(CS.placement, grade_mode="nope")))
    with pytest.raises(ValueError):
        _validate(dataclasses.replace(CS, modes={"1v1": ModeConfig(ladder="nope")}))


# --- own-ladder (1v1) integration ----------------------------------------------

def _run_ladder_isolation():
    async def _main():
        os.environ["TURSO_DATABASE_URL"] = "file:" + DB.replace("\\", "/")

        from core import db
        from core.schema import ensure_schema
        import cogs.ranking
        from cogs.ranking import RankingCog

        cogs.ranking._append_match_log = lambda *_: None

        # Map 1v1 onto its own ladder (3 placements) for the duration.
        old_modes = ACTIVE.modes
        object.__setattr__(
            ACTIVE, "modes", {"1v1": ModeConfig(ladder="own", placement_games=3)}
        )
        try:
            await db.close()
            if os.path.exists(DB):
                os.remove(DB)
            await ensure_schema()

            class FakeRole:
                def __init__(self, name):
                    self.name = name

            class FakeUser:
                name = display_name = "staff"
                from config.settings import MATCH_STAFF_ROLE as _ms
                roles = [FakeRole(_ms)]

            class FakeGuild:
                members, roles = [], []

            class FakeResponse:
                async def defer(self, *a, **k): ...
                async def send_message(self, *a, **k): ...

            class FakeFollowup:
                async def send(self, *a, **k): ...

            class FakeInteraction:
                def __init__(self):
                    self.response, self.followup = FakeResponse(), FakeFollowup()
                    self.user, self.guild = FakeUser(), FakeGuild()

            class FakeBot:
                def get_guild(self, _): return None

            for nm, elo_v in [("duelist", 1500), ("target", 1200)]:
                await db.execute(
                    "INSERT INTO players (name, elo, rank, matches_played, matches_won, "
                    "placement_done, coins) VALUES (?, ?, '[A3 | 1450-1649]', 40, 20, 1, 0)",
                    (nm, elo_v),
                )

            cog = RankingCog(FakeBot())

            async def play_duel():
                await cog.rank.callback(
                    cog, FakeInteraction(),
                    player_names="duelist,target", match_results="W,L",
                    scores="60,30", points="15,7",
                )

            # Three 1v1 games = the 1v1 placement; the MAIN ladder must not move.
            for _ in range(3):
                await play_duel()
            main = await db.fetchone(
                "SELECT elo, matches_played, coins FROM players WHERE name = 'duelist'"
            )
            assert main[0] == 1500, f"main-ladder Elo moved: {main[0]}"
            assert main[1] == 40, "main-ladder matches_played moved"
            assert main[2] == 300, "coins are account-wide: 3 games x 100"

            mrow = await db.fetchone(
                "SELECT elo, rank, placement_done FROM mode_ratings "
                "WHERE player_name = 'duelist' AND mode = '1v1'"
            )
            assert mrow is not None and mrow[2] == 1, "1v1 placement did not graduate"
            assert mrow[0] > 0, "1v1 ladder has no Elo"

            hist = await db.fetchone(
                "SELECT COUNT(*) FROM match_history WHERE mode = '1v1'"
            )
            assert hist[0] == 6, f"expected 6 1v1 history rows, got {hist[0]}"

            # Undo the graduation game: 1v1 row back to 2/3, main still frozen.
            await cog.undo_last_match.callback(cog, FakeInteraction())
            mrow = await db.fetchone(
                "SELECT placement_done, placement_games_played FROM mode_ratings "
                "WHERE player_name = 'duelist' AND mode = '1v1'"
            )
            assert mrow[0] == 0 and mrow[1] == 2, f"undo mis-restored 1v1 row: {mrow}"
            main = await db.fetchone("SELECT elo FROM players WHERE name = 'duelist'")
            assert main[0] == 1500

            await db.close()
            os.remove(DB)
        finally:
            object.__setattr__(ACTIVE, "modes", old_modes)

    asyncio.run(_main())


def test_own_ladder_isolation():
    _run_ladder_isolation()


if __name__ == "__main__":
    for fn_name, fn in sorted(globals().items()):
        if fn_name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok: {fn_name}")
    print("\nMMR V2 TESTS PASSED")
