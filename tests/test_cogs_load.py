"""Regression test: every cog loads and the full command set registers cleanly.

Runs the bot's extension loading offline (no Discord connection) and asserts the
expected slash commands are present with no duplicates. Run from the project root:

    python tests/test_cogs_load.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402

EXPECTED = {
    # moderation
    "report", "viewreports", "timeout", "timeouthistory", "leavinghistory",
    # progression
    "checkachievements", "givebadge", "addbadge", "removebadge",
    "add_seasonal_reward", "remove_seasonal_reward",
    # admin (note: /backupdb from the README was never implemented as a slash
    # command — AdminCog has a daily_backup task and prefix commands only)
    "help",
    # players (settitle removed — titles are equipped on the website now)
    "addplayer", "removeplayer", "renameplayer", "checkplayer", "leaderboard",
    "setcolor", "checkperformance", "matchhistory", "seasonstats",
    # cosmetics
    "createitem", "deleteitem", "giveitem", "revokeitem", "listitems",
    "checkinventory", "givecoins", "setprice",
    # ranking
    "rank", "ranktie", "ocr2rank", "addelo", "removeelo", "refresh_top10",
    "update_roles", "undolastmatch", "recentmatches",
    # matchflow
    "mapvote", "teamselection", "vote_tie", "resetdb",
    # queue
    "queue", "resetqueue", "cancelqueue", "gamemode", "createparty", "invite", "leaveparty", "viewparty",
    # profile
    "profile",
}


async def _run():
    for ext in main.cogs.EXTENSIONS:
        await main.bot.load_extension(ext)
    names = [c.name for c in main.bot.tree.get_commands()]
    dupes = sorted({n for n in names if names.count(n) > 1})
    assert not dupes, f"Duplicate commands: {dupes}"
    missing = EXPECTED - set(names)
    assert not missing, f"Missing commands: {missing}"
    print(f"  ok: {len(names)} commands across {len(main.bot.cogs)} cogs, no duplicates")
    # Stop background tasks so the loop exits cleanly (defensive: only cancel
    # loops that actually exist on the loaded cogs).
    for cog_name, task_name in [
        ("ProgressionCog", "update_badges"),
        ("SocialCog", "poll_dm_outbox"),
        ("QueueCog", "poll_web_queue"),
        ("AdminCog", "daily_backup"),
    ]:
        cog = main.bot.get_cog(cog_name)
        task = getattr(cog, task_name, None) if cog else None
        if task is not None:
            task.cancel()


if __name__ == "__main__":
    print("Running cog-load test...")
    asyncio.run(_run())
    print("\nCOG LOAD TEST PASSED")
