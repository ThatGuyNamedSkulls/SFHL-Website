"""End-to-end test: run the real /rank command, then /undolastmatch, against a
local libsql file DB with a fake Discord interaction — and confirm players are
restored exactly.

    python tests/test_rank_integration.py
"""

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Point the async DB layer at a temp local libsql file BEFORE importing it.
DB = os.path.join(tempfile.gettempdir(), f"rankint_{os.getpid()}.db")
os.environ["TURSO_DATABASE_URL"] = "file:" + DB.replace("\\", "/")
os.environ.pop("TURSO_AUTH_TOKEN", None)

from config.settings import MATCH_STAFF_ROLE  # noqa: E402
from core import db  # noqa: E402
from core.schema import ensure_schema  # noqa: E402
import cogs.ranking  # noqa: E402
from cogs.ranking import RankingCog, _SNAPSHOT_COLS  # noqa: E402


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


async def full(name):
    cols = ", ".join(_SNAPSHOT_COLS)
    row = await db.fetchone(f"SELECT {cols} FROM players WHERE name = ?", (name,))
    return tuple(row) if row else None


async def _run():
    # Silence the match log file write.
    cogs.ranking._append_match_log = lambda *_: None

    await db.close()
    if os.path.exists(DB):
        os.remove(DB)
    await ensure_schema()
    for nm, elo in [("alice", 1200), ("bob", 1180)]:
        await db.execute(
            "INSERT INTO players (name, elo, rank, matches_played, matches_won, placement_done) "
            "VALUES (?, ?, '[A1 | 1100-1249]', 10, 5, 1)",
            (nm, elo),
        )

    before = {n: await full(n) for n in ("alice", "bob")}

    cog = RankingCog(FakeBot())
    inter = FakeInteraction()
    await cog.rank.callback(
        cog, inter,
        player_names="alice,bob", match_results="W,L", scores="40,25", points="13,11",
        kills="20,12", deaths="10,15", assists="5,3", mvps="3,1", hs="40.0,30.0",
        map_name="Inferno", region="EU", play_time="24:21",
        # Explicit mode: this test exercises the MAIN ladder; without it a
        # 2-player lineup would be inferred as 1v1 (an own ladder under the
        # valorant-style profile) and the players table wouldn't move.
        mode="5v5",
    )
    after_rank = {n: await full(n) for n in ("alice", "bob")}
    check("/rank changed both players",
          after_rank["alice"] != before["alice"] and after_rank["bob"] != before["bob"])

    row = await db.fetchone(
        "SELECT COUNT(*), COUNT(undo_state), COUNT(match_id) FROM match_history"
    )
    check("/rank wrote 2 history rows with undo_state + match_id", tuple(row) == (2, 2, 2))

    async def coins(n):
        return (await db.fetchone("SELECT coins FROM players WHERE name = ?", (n,)))[0]

    check("/rank awarded +100 HL coins to each player",
          await coins("alice") == 100 and await coins("bob") == 100)

    # Undo and confirm exact restoration.
    inter2 = FakeInteraction()
    await cog.undo_last_match.callback(cog, inter2)
    after_undo = {n: await full(n) for n in ("alice", "bob")}
    check("/undolastmatch restored alice exactly", after_undo["alice"] == before["alice"])
    check("/undolastmatch restored bob exactly", after_undo["bob"] == before["bob"])
    n_hist_row = await db.fetchone("SELECT COUNT(*) FROM match_history")
    check("/undolastmatch deleted the match's history rows", n_hist_row[0] == 0)
    check("/undolastmatch reverted the coin award",
          await coins("alice") == 0 and await coins("bob") == 0)

    await db.close()
    os.remove(DB)


if __name__ == "__main__":
    print("Running /rank -> /undolastmatch integration test...")
    asyncio.run(_run())
    print("\nRANK INTEGRATION TEST PASSED")
