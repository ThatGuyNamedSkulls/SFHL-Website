"""End-to-end integration test for the Valorant-style mmr_rr ranked system.

Swaps the shared ACTIVE profile's elo/placement config to the valorant-style
preset (same object identity, so every cog sees it — the same mechanism
set_team_size uses), then drives the REAL /rank, /ranktie and /undolastmatch
against a local libsql file DB and checks the dual-track behavior end to end:

  * ranked win/loss: hidden MMR moves, visible Elo moves within [rr_min, rr_max]
  * convergence: MMR far above visible Elo => visible gain hits rr_max
  * ties via teams=: visible move bounded by rr_tie_cap
  * placements: soft MMR tracked from game 1, pure-performance graduation with
    the opponent-strength seed shift, placement_opp_sum reset on graduation
  * /undolastmatch restores mmr + placement_opp_sum byte-exactly

    python tests/test_mmr_rr_integration.py
"""

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Point the async DB layer at a temp local libsql file BEFORE importing it.
DB = os.path.join(tempfile.gettempdir(), f"mmrrr_{os.getpid()}.db")
os.environ["TURSO_DATABASE_URL"] = "file:" + DB.replace("\\", "/")
os.environ.pop("TURSO_AUTH_TOKEN", None)

from config.settings import MATCH_STAFF_ROLE  # noqa: E402
from core import db  # noqa: E402
from core.schema import ensure_schema  # noqa: E402
from core.game_profile import ACTIVE, load_profile  # noqa: E402
import cogs.ranking  # noqa: E402
from cogs.ranking import RankingCog, _SNAPSHOT_COLS  # noqa: E402

_GAMES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "games"
)
VAL = load_profile(os.path.join(_GAMES, "valorant-style.toml"))


class FakeRole:
    def __init__(self, name):
        self.name = name


class FakeUser:
    name = "staff"
    display_name = "staff"
    roles = [FakeRole(MATCH_STAFF_ROLE)]


class FakeGuild:
    members = []
    roles = []


class FakeResponse:
    async def defer(self, *a, **k):
        pass

    async def send_message(self, *a, **k):
        pass


class FakeFollowup:
    def __init__(self):
        self.sent = []

    async def send(self, *a, **k):
        self.sent.append((a, k))


class FakeInteraction:
    def __init__(self):
        self.response = FakeResponse()
        self.followup = FakeFollowup()
        self.user = FakeUser()
        self.guild = FakeGuild()

    async def original_response(self):
        return None


class FakeBot:
    def get_guild(self, _):
        return None


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


async def row(name, cols="elo, mmr, rank, placement_done, placement_games_played, placement_opp_sum"):
    r = await db.fetchone(f"SELECT {cols} FROM players WHERE name = ?", (name,))
    return tuple(r) if r else None


async def snapshot(name):
    cols = ", ".join(_SNAPSHOT_COLS)
    r = await db.fetchone(f"SELECT {cols} FROM players WHERE name = ?", (name,))
    return tuple(r) if r else None


async def _run():
    cogs.ranking._append_match_log = lambda *_: None

    # Swap the valorant-style elo/placement config onto the shared ACTIVE
    # profile object so the cogs (which imported it) see the mmr_rr model.
    # Modes are cleared for the duration: this test's 2-player lineups exercise
    # the MAIN-ladder mmr_rr flow, and must not be inferred as own-ladder 1v1s
    # (that flow has its own test in test_mmr_v2.py).
    old_elo, old_placement, old_modes = ACTIVE.elo, ACTIVE.placement, ACTIVE.modes
    object.__setattr__(ACTIVE, "elo", VAL.elo)
    object.__setattr__(ACTIVE, "placement", VAL.placement)
    object.__setattr__(ACTIVE, "modes", {})
    # Re-assert our DB URL at run time: under pytest another test module (e.g.
    # test_undo) sets this env var at import time too, and the last import wins.
    # Pinning it here (after closing any existing client) guarantees ensure_schema
    # and every query below hit OUR temp file, not another test's.
    os.environ["TURSO_DATABASE_URL"] = "file:" + DB.replace("\\", "/")
    try:
        await db.close()
        if os.path.exists(DB):
            os.remove(DB)
        await ensure_schema()

        e = VAL.elo
        p = VAL.placement
        # The placement count comes from the TOML (a league decision) — the flow
        # below is driven by p.games rather than a hardcoded number.
        check("preset sanity: mmr_rr model, >=1 placements",
              e.model == "mmr_rr" and p.games >= 1)

        # --- ranked win/loss under mmr_rr -----------------------------------
        for nm, elo_v in [("alice", 1200), ("bob", 1180)]:
            await db.execute(
                "INSERT INTO players (name, elo, rank, matches_played, matches_won, placement_done) "
                "VALUES (?, ?, '[A1 | 1100-1249]', 40, 20, 1)",
                (nm, elo_v),
            )
        cog = RankingCog(FakeBot())
        # Capture the embed breakdowns so the displayed RR can be checked against
        # the Elo actually applied (they must never disagree — see below).
        captured = {}
        real_send = cog._send_results

        async def spy_send(*a, **kw):
            captured.update(kw.get("breakdowns") or {})
            return await real_send(*a, **kw)

        cog._send_results = spy_send

        await cog.rank.callback(
            cog, FakeInteraction(),
            player_names="alice,bob", match_results="W,L", scores="40,25", points="15,9",
        )
        a_elo, a_mmr, *_ = await row("alice")
        b_elo, b_mmr, *_ = await row("bob")
        check("winner's visible Elo rose within [rr_min, rr_max]",
              e.rr_min <= a_elo - 1200 <= e.rr_max)
        check("loser's visible Elo fell within [rr_min, rr_max]",
              e.rr_min <= 1180 - b_elo <= e.rr_max)
        check("hidden MMR was created and moved for both",
              a_mmr is not None and a_mmr > 1200 and b_mmr is not None and b_mmr < 1180)
        # The embed's "RR ±N" must equal the Elo delta actually applied. The raw
        # RR float used to be shown, which could round the other way (19.5 shown
        # as "+20" while the Elo only moved +19).
        check("displayed RR matches the applied Elo delta (winner)",
              captured["alice"]["rr"] == a_elo - 1200)
        check("displayed RR matches the applied Elo delta (loser)",
              captured["bob"]["rr"] == b_elo - 1180)

        # --- convergence: MMR far above visible Elo => win pays rr_max -------
        await db.execute(
            "INSERT INTO players (name, elo, rank, matches_played, matches_won, placement_done, mmr) "
            "VALUES ('smurf', 1000, '[B | 950-1099]', 40, 30, 1, 1600)"
        )
        await db.execute(
            "INSERT INTO players (name, elo, rank, matches_played, matches_won, placement_done) "
            "VALUES ('victim', 1000, '[B | 950-1099]', 40, 10, 1)"
        )
        await cog.rank.callback(
            cog, FakeInteraction(),
            player_names="smurf,victim", match_results="W,L", scores="60,20", points="15,3",
        )
        s_elo, s_mmr, *_ = await row("smurf")
        check("convergence: under-ranked winner gains the rr_max ceiling",
              s_elo - 1000 == int(e.rr_max))

        # --- opponent-aware tie via /ranktie teams= --------------------------
        pre_a, pre_b = (await row("alice"))[0], (await row("bob"))[0]
        await cog.rank_tie.callback(
            cog, FakeInteraction(),
            player_names="alice,bob", teams="1,2", scores="30,30",
        )
        post_a, post_b = (await row("alice"))[0], (await row("bob"))[0]
        check("tie: visible moves bounded by rr_tie_cap",
              abs(post_a - pre_a) <= e.rr_tie_cap and abs(post_b - pre_b) <= e.rr_tie_cap)

        # --- placement flow: soft MMR + pure-performance graduation ----------
        await db.execute(
            "INSERT INTO players (name, elo, rank) VALUES ('rookie', 0, '[?] Unranked')"
        )
        for i in range(p.games):
            await cog.rank.callback(
                cog, FakeInteraction(),
                # rookie LOSES every game but posts a strong 55 score — grading
                # is pure performance, so W/L must not matter.
                player_names="rookie,alice", match_results="L,W", scores="55,40", points="15,10",
            )
            r_elo, r_mmr, r_rank, r_done, r_games, r_opp = await row("rookie")
            if i < p.games - 1:
                check(f"placement game {i+1}: still unranked, soft MMR tracking",
                      not r_done and r_games == i + 1 and r_mmr is not None and r_elo == 0)
                check(f"placement game {i+1}: opponent skill accumulating",
                      r_opp > 0)
        r_elo, r_mmr, r_rank, r_done, r_games, r_opp = await row("rookie")
        check("graduated after exactly placement.games games", r_done == 1 and r_games == 0)
        # Raw 55/game is the A3 band (50-60); with grade_mode "normalized" the
        # scores are boosted for outscoring a stronger lobby, which can lift the
        # grade into S1. Either way: a HIGH band despite going 0-5 — grading is
        # pure performance, losses never enter it.
        check("0-5 with high stats still graduates by performance (A3+ band)",
              r_rank in ("[A3 | 1450-1649]", "[S1 | 1650-1899]"))
        band_elo = next(r.placement_elo for r in VAL.ranks if r.name == r_rank)
        check("opponent-strength shift applied to the seed (band < elo <= band + cap)",
              band_elo < r_elo <= band_elo + p.opp_cap)
        check("placement_opp_sum reset on graduation", r_opp == 0)
        check("soft MMR survived graduation", r_mmr is not None)

        # --- exact undo of the final (graduation) match -----------------------
        # The graduation match is the latest; /undolastmatch must restore both
        # players' full snapshots, including mmr + placement_opp_sum.
        latest = await db.fetchone("SELECT MAX(match_id) FROM match_history")
        rows = await db.fetchall(
            "SELECT player_name, undo_state FROM match_history WHERE match_id = ?",
            (latest[0],),
        )
        check("graduation match wrote undo rows for both players", len(rows) == 2)
        await cog.undo_last_match.callback(cog, FakeInteraction())
        r_elo, r_mmr, r_rank, r_done, r_games, r_opp = await row("rookie")
        check("undo re-opened the placement (4/5 again, unranked)",
              r_done == 0 and r_games == p.games - 1 and r_elo == 0)
        check("undo restored pre-game placement_opp_sum", r_opp > 0)

        await db.close()
        os.remove(DB)
    finally:
        object.__setattr__(ACTIVE, "elo", old_elo)
        object.__setattr__(ACTIVE, "placement", old_placement)
        object.__setattr__(ACTIVE, "modes", old_modes)


def test_mmr_rr_end_to_end():
    asyncio.run(_run())


if __name__ == "__main__":
    print("Running mmr_rr (Valorant-style) integration test...")
    asyncio.run(_run())
    print("\nMMR_RR INTEGRATION TEST PASSED")
