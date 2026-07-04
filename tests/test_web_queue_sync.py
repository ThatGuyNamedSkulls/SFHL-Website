"""Two-way web<->Discord queue sync test for QueueCog.poll_web_queue.

Runs the real reconciliation against a local libsql file DB with a fake guild,
covering all four directions:

    website join  -> added to the Discord in-memory queue
    website leave -> removed from the Discord queue
    Discord join  -> mirrored into the web_queue table (so the site shows them)
    Discord leave -> removed from the web_queue table

    python tests/test_web_queue_sync.py
"""

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = os.path.join(tempfile.gettempdir(), f"webqsync_{os.getpid()}.db")
os.environ["TURSO_DATABASE_URL"] = "file:" + DB.replace("\\", "/")
os.environ.pop("TURSO_AUTH_TOKEN", None)

from core import db  # noqa: E402
from core.schema import ensure_schema  # noqa: E402
from cogs import queue_state  # noqa: E402
from cogs.queue_state import get_current_queue  # noqa: E402
from cogs.queue import QueueCog  # noqa: E402


class FakeRole:
    def __init__(self, name):
        self.name = name


class FakeMember:
    def __init__(self, mid, name, roles=None):
        self.id = mid
        self.display_name = name
        self.mention = f"<@{mid}>"
        # Poll now checks member.roles for the blacklist role.
        self.roles = roles or []


class FakeGuild:
    def __init__(self):
        self._members = {}

    def register(self, m):
        self._members[m.id] = m

    def get_member(self, mid):
        return self._members.get(mid)


class FakeBot:
    def __init__(self, guild):
        self._guild = guild

    def add_view(self, _):
        pass

    def get_guild(self, _):
        return self._guild

    def get_channel(self, _):
        return None


def check(label, cond):
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok: {label}")


async def web_ids():
    rows = await db.fetchall("SELECT discord_user_id FROM web_queue")
    return {int(r[0]) for r in rows}


async def _run():
    if os.path.exists(DB):
        os.remove(DB)
    await ensure_schema()

    guild = FakeGuild()
    alice = FakeMember(1, "alice")
    bob = FakeMember(2, "bob")
    guild.register(alice)
    guild.register(bob)

    cog = QueueCog(FakeBot(guild))
    cog.poll_web_queue.cancel()  # drive it manually instead of on a timer

    async def poll():
        await cog.poll_web_queue.coro(cog)

    q = get_current_queue()

    # 1) Website join -> Discord queue.
    await db.execute(
        "INSERT INTO web_queue (discord_user_id, discord_username, player_name) VALUES (?,?,?)",
        ("1", "alice", "alice"),
    )
    await poll()
    check("website join adds alice to the Discord queue", alice in q)
    check("alice's web row is kept (still visible on site)", await web_ids() == {1})

    # Idempotent: another poll with no change keeps her exactly once.
    await poll()
    check("no duplicate add on a steady poll", q.count(alice) == 1)

    # 2) Discord join -> mirrored into web_queue.
    q.append(bob)
    await poll()
    check("Discord join mirrors bob into web_queue", await web_ids() == {1, 2})
    check("bob stays in the Discord queue", bob in q)

    # 3) Website leave -> removed from the Discord queue.
    await db.execute("DELETE FROM web_queue WHERE discord_user_id = ?", ("1",))
    await poll()
    check("website leave removes alice from the Discord queue", alice not in q)
    check("bob unaffected by alice leaving", bob in q and await web_ids() == {2})

    # 4) Discord leave -> removed from web_queue.
    q.remove(bob)
    await poll()
    check("Discord leave removes bob's web row", await web_ids() == set())
    check("queue is now empty", len(q) == 0)

    # 5) Match start (queue cleared) removes any mirrored rows.
    await db.execute(
        "INSERT INTO web_queue (discord_user_id, discord_username, player_name) VALUES (?,?,?)",
        ("1", "alice", "alice"),
    )
    await poll()  # alice back in
    check("alice re-queued from web", alice in q)
    q.clear()  # simulate create_game_channel clearing the queue
    await poll()
    check("match start clears alice's web row too", await web_ids() == set())

    # 5b) A blacklisted user must NOT be added via the website (H2).
    from config.settings import BLACKLIST_ROLE
    carol = FakeMember(3, "carol", roles=[FakeRole(BLACKLIST_ROLE)])
    guild.register(carol)
    await db.execute(
        "INSERT INTO web_queue (discord_user_id, discord_username, player_name) VALUES (?,?,?)",
        ("3", "carol", "carol"),
    )
    await poll()
    check("blacklisted web user is not added to the queue", carol not in q)
    check("blacklisted user's web row is dropped", await web_ids() == set())

    # 6) Website party members are grouped (👥) in the Discord queue embed.
    import json
    from cogs.queue_state import web_party_members

    await db.execute(
        "CREATE TABLE IF NOT EXISTS web_parties "
        "(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    )
    party = {"id": "p1", "leaderId": "1", "members": [{"discordId": "1"}, {"discordId": "2"}]}
    await db.execute(
        "INSERT OR REPLACE INTO web_parties (id, data, updated_at) VALUES (?,?,?)",
        ("p1", json.dumps(party), 1),
    )
    # The queue route would insert every party member; simulate that here.
    for uid, nm in [("1", "alice"), ("2", "bob")]:
        await db.execute(
            "INSERT INTO web_queue (discord_user_id, discord_username, player_name) VALUES (?,?,?)",
            (uid, nm, nm),
        )
    await poll()
    check("party join queued both members", alice in q and bob in q)
    check("web party cache groups alice -> {1,2}", set(web_party_members.get(1, [])) == {1, 2})
    field = cog.queue_view.get_queue_embed().fields[0].value
    check("queue embed groups the web party (party marker present)", "\U0001f465" in field)
    check(
        "grouped line lists both members together",
        any("\U0001f465" in line and alice.mention in line and bob.mention in line
            for line in field.splitlines()),
    )

    await db.close()
    os.remove(DB)


if __name__ == "__main__":
    print("Running web<->Discord queue sync test...")
    asyncio.run(_run())
    print("\nWEB QUEUE SYNC TEST PASSED")
