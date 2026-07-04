"""Tests for /undolastmatch's exact-reversal machinery.

Covers: full snapshot round-trip (a player restored to byte-identical pre-match
state, incl. placement fields and peak Elo) and achievement reversion.

Runs against a local libsql file database (no Turso network access needed).

    python tests/test_undo.py
"""

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Point the async DB layer at a temp local libsql file BEFORE importing it.
_DB_FILE = os.path.join(tempfile.gettempdir(), f"undo_{os.getpid()}.db")
os.environ["TURSO_DATABASE_URL"] = "file:" + _DB_FILE.replace("\\", "/")
os.environ.pop("TURSO_AUTH_TOKEN", None)

from core import db  # noqa: E402
from core.schema import ensure_schema  # noqa: E402
from cogs.ranking import _capture_state, _restore_state, _SNAPSHOT_COLS  # noqa: E402
import core.achievements as ach  # noqa: E402


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


async def _fresh_db():
    """Reset the client and rebuild an empty schema in the temp file."""
    await db.close()
    if os.path.exists(_DB_FILE):
        os.remove(_DB_FILE)
    await ensure_schema()


async def _full_row(name):
    cols = ", ".join(_SNAPSHOT_COLS)
    row = await db.fetchone(f"SELECT {cols} FROM players WHERE name = ?", (name,))
    return tuple(row) if row else None


async def test_snapshot_roundtrip_regular():
    await _fresh_db()
    await db.execute(
        """INSERT INTO players (name, elo, rank, matches_played, matches_won, peak_elo,
           total_kills, total_deaths, total_assists, total_mvps, total_score,
           total_headshot_percentage, total_play_time, avg_hs_percent, kd_ratio,
           placement_points, placement_games_played, placement_done)
           VALUES ('a',1000,'[B | 950-1099]',5,3,1050,100,80,30,10,200,150.0,3600,30.0,1.25,0,0,1)"""
    )
    before = await _full_row("a")
    snap = await _capture_state("a")

    # Simulate a /rank match touching many columns.
    await db.execute(
        """UPDATE players SET elo=1020, rank='[A1 | 1100-1249]', matches_played=6, matches_won=4,
           peak_elo=1060, total_kills=120, total_deaths=90, total_assists=33, total_mvps=12,
           total_score=240, total_headshot_percentage=183.4, avg_hs_percent=30.6, kd_ratio=1.33
           WHERE name='a'"""
    )
    assert await _full_row("a") != before  # changed

    await _restore_state("a", snap)
    check("regular match: full snapshot restores exact pre-match state", await _full_row("a") == before)


async def test_snapshot_roundtrip_placement_graduation():
    await _fresh_db()
    # Mid-placement player: 2/3 games, 40 points, still unranked at elo 0.
    await db.execute(
        """INSERT INTO players (name, elo, rank, placement_points, placement_games_played,
           placement_done) VALUES ('b',0,'[?] Unranked',40,2,0)"""
    )
    before = await _full_row("b")
    snap = await _capture_state("b")

    # Simulate graduation on the 3rd game.
    await db.execute(
        """UPDATE players SET rank='[A1 | 1100-1249]', elo=1175, placement_points=0,
           placement_games_played=0, placement_done=1, matches_played=matches_played+1 WHERE name='b'"""
    )
    assert await _full_row("b") != before

    await _restore_state("b", snap)
    check("placement graduation is fully reversible (back to unranked, 2/3, 40 pts)",
          await _full_row("b") == before)


async def test_achievement_revert():
    await _fresh_db()

    await ach.update_achievement_progress("a", "Points Mastery", 600)   # Bronze(500) reached
    await ach.update_achievement_progress("a", "Points Mastery", 1500)  # now 2100 -> Silver(2000)
    row = await db.fetchone(
        "SELECT progress, level FROM achievements WHERE player_name='a' AND achievement_name='Points Mastery'"
    )
    prog, level = row[0], row[1]
    check("achievement built up to Silver at 2100", prog == 2100 and level == "Silver")

    await ach.revert_achievement_progress("a", "Points Mastery", 1500)  # back to 600 -> Bronze
    row = await db.fetchone(
        "SELECT progress, level FROM achievements WHERE player_name='a' AND achievement_name='Points Mastery'"
    )
    prog, level = row[0], row[1]
    check("revert subtracts progress and demotes level (600 -> Bronze)", prog == 600 and level == "Bronze")


async def _main():
    print("Running undo machinery tests...")
    await test_snapshot_roundtrip_regular()
    await test_snapshot_roundtrip_placement_graduation()
    await test_achievement_revert()
    await db.close()
    if os.path.exists(_DB_FILE):
        os.remove(_DB_FILE)
    print("\nALL UNDO TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(_main())
