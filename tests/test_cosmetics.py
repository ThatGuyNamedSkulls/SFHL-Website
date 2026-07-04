"""Cosmetics (profile cards / titles / badges) tests.

Runs the real core.cosmetics logic against a local libsql file DB:

    schema + built-in seed
    grant/revoke (incl. equipped-title mirror into players.title)
    dynamic Top 10 badge sync (grant + revoke on drop-out)
    season placement tiers (Champion / Top 3 / Top 10, best tier only)
    /renameplayer-style inventory move

    python tests/test_cosmetics.py
"""

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = os.path.join(tempfile.gettempdir(), f"cosmetics_{os.getpid()}.db")
os.environ["TURSO_DATABASE_URL"] = "file:" + DB.replace("\\", "/")
os.environ.pop("TURSO_AUTH_TOKEN", None)

from core import db  # noqa: E402
from core.schema import ensure_schema  # noqa: E402
from core.cosmetics import (  # noqa: E402
    TOP10_BADGE_SLUG,
    award_season_placements,
    ensure_item,
    get_item,
    grant_item,
    revoke_item,
    delete_item,
    sync_top10_badge,
)


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


async def add_player(name, elo, wins=0, played=0):
    await db.execute(
        "INSERT INTO players (name, elo, rank, matches_won, matches_played) "
        "VALUES (?, ?, '[?] Unranked', ?, ?)",
        (name, elo, wins, played),
    )


async def inv(name):
    rows = await db.fetchall(
        """SELECT i.slug, i.type, inv.equipped FROM cosmetic_inventory inv
           JOIN cosmetic_items i ON i.id = inv.item_id WHERE inv.player_name = ?""",
        (name,),
    )
    return {r[0]: {"type": r[1], "equipped": r[2]} for r in rows}


async def _run():
    if os.path.exists(DB):
        os.remove(DB)
    await ensure_schema()

    # 1) Schema + seed.
    check("built-in Top 10 badge is seeded", await get_item(TOP10_BADGE_SLUG) is not None)
    await ensure_schema()  # idempotent
    rows = await db.fetchall(
        "SELECT COUNT(*) FROM cosmetic_items WHERE slug = ?", (TOP10_BADGE_SLUG,)
    )
    check("seed is idempotent (no duplicate)", rows[0][0] == 1)

    # 2) Grants.
    await add_player("alice", 1500, wins=20, played=30)
    await add_player("bob", 1200, wins=10, played=25)
    await ensure_item("cool-card", "card", "Cool Card", asset="/profilecards/cool.png")
    await ensure_item("the-goat", "title", "The GOAT")

    check("grant to missing player rejected",
          await grant_item("nobody", "cool-card", "admin") == "no_such_player")
    check("grant of missing item rejected",
          await grant_item("alice", "nope", "admin") == "no_such_item")
    check("grant works", await grant_item("alice", "cool-card", "admin") == "granted")
    check("re-grant reports already_owned",
          await grant_item("alice", "cool-card", "admin") == "already_owned")

    # 3) Equipped-title revoke clears players.title (mirror).
    await grant_item("alice", "the-goat", "admin")
    item = await get_item("the-goat")
    await db.batch([
        ("UPDATE cosmetic_inventory SET equipped = 1 WHERE player_name = ? AND item_id = ?",
         ("alice", item[0])),
        ("UPDATE players SET title = ? WHERE name = ?", ("The GOAT", "alice")),
    ])  # simulate the website equipping it
    check("revoke of equipped title returns True", await revoke_item("alice", "the-goat"))
    row = await db.fetchone("SELECT title FROM players WHERE name = ?", ("alice",))
    check("players.title mirror cleared on revoke", row[0] == "")
    check("revoking an unowned item returns False",
          await revoke_item("alice", "the-goat") is False)

    # 4) Dynamic Top 10 badge: grant on entry, delete on drop-out.
    await sync_top10_badge()
    check("top10 badge granted to alice", TOP10_BADGE_SLUG in await inv("alice"))
    check("top10 badge granted to bob", TOP10_BADGE_SLUG in await inv("bob"))
    # 9 stronger players: alice (1500) hangs on at #10, bob (1200) drops to #11.
    for i in range(9):
        await add_player(f"pro{i}", 2000 + i)
    await sync_top10_badge()
    check("alice keeps the badge (still top 10)", TOP10_BADGE_SLUG in await inv("alice"))
    check("bob loses the badge on drop-out", TOP10_BADGE_SLUG not in await inv("bob"))
    # Zero-elo players never get it (post-reset guard).
    await add_player("fresh", 0)
    await sync_top10_badge()
    check("elo-0 player never gets the top10 badge",
          TOP10_BADGE_SLUG not in await inv("fresh"))

    # 5) Season placements: best tier only.
    lines = await award_season_placements("Season 1")
    standings = [
        r[0] for r in await db.fetchall(
            """SELECT name FROM players WHERE elo > 0
               ORDER BY elo DESC, matches_won DESC, matches_played ASC LIMIT 10"""
        )
    ]
    first, second = standings[0], standings[1]
    check("champion badge granted to #1", "season-1-champion" in await inv(first))
    check("#1 does not also get top-3", "season-1-top-3" not in await inv(first))
    check("#2 gets top-3", "season-1-top-3" in await inv(second))
    check("#2 does not get champion", "season-1-champion" not in await inv(second))
    check("10 placement lines returned", len(lines) == 10)
    check("re-award is idempotent", await award_season_placements("Season 1") == [])
    item = await get_item("season-1-champion")
    check("seasonal item stamped with season", item[7] == "Season 1")

    # 6) Rename moves the inventory (the statement /renameplayer uses).
    await db.execute(
        "UPDATE cosmetic_inventory SET player_name = ? WHERE player_name = ?",
        ("alice2", "alice"),
    )
    check("rename moves inventory rows", "cool-card" in await inv("alice2"))
    check("old name has nothing left", await inv("alice") == {})

    # 7) delete_item wipes catalog + inventories and clears equipped titles.
    await add_player("carol", 900)
    await ensure_item("legend", "title", "Legend")
    await grant_item("carol", "legend", "admin")
    litem = await get_item("legend")
    await db.batch([
        ("UPDATE cosmetic_inventory SET equipped = 1 WHERE player_name = ? AND item_id = ?",
         ("carol", litem[0])),
        ("UPDATE players SET title = ? WHERE name = ?", ("Legend", "carol")),
    ])
    check("delete_item returns True", await delete_item("legend"))
    check("catalog row gone", await get_item("legend") is None)
    check("inventories emptied", "legend" not in await inv("carol"))
    row = await db.fetchone("SELECT title FROM players WHERE name = ?", ("carol",))
    check("equipped-title holders' players.title cleared", row[0] == "")

    await db.close()
    os.remove(DB)


if __name__ == "__main__":
    print("Running cosmetics tests...")
    asyncio.run(_run())
    print("\nCOSMETICS TESTS PASSED")
