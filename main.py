# At the start, only God and the machine knew how this works. Now, only God does.

import asyncio
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

import discord
from discord.ext import commands
from dotenv import load_dotenv

# Load environment variables from .env (gitignored). Secrets must never be
# hardcoded in source — see .env.example for the required keys.
load_dotenv()

# Configure logging. Force UTF-8 so rank names containing ★ and emoji don't crash
# the handlers on Windows (whose console defaults to cp1252).
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        # Rotate so bot.log can't grow unbounded: 5 MB x 3 backups.
        RotatingFileHandler(
            "bot.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        ),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

import cogs
from config.settings import GUILD_ID
from core.schema import ensure_schema
from core.players import register_elo_observer
from cogs.roles import refresh_top10_roles as _refresh_top10_roles

intents = discord.Intents.default()
intents.members = True
intents.message_content = True


class SFHLBot(commands.Bot):
    async def setup_hook(self) -> None:
        # Ensure all DB tables/columns exist before any command runs. Must happen
        # inside the event loop now that the DB layer (Turso/libsql) is async.
        try:
            await ensure_schema()
        except Exception:
            logger.exception("Failed to ensure database schema")

        # Load command cogs before the gateway connects.
        for ext in cogs.EXTENSIONS:
            try:
                await self.load_extension(ext)
                logger.info(f"Loaded extension: {ext}")
            except Exception:
                logger.exception(f"Failed to load extension: {ext}")

        # Sync commands to our guild so they appear instantly (global propagation
        # can take up to an hour). copy_global_to mirrors every global command
        # into the guild scope; this also covers /queue, which used to be guild-
        # scoped but was never synced.
        try:
            guild = discord.Object(id=GUILD_ID)
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            logger.info(f"Synced {len(synced)} commands to guild {GUILD_ID}.")
        except Exception:
            logger.exception("Failed to sync commands to guild")


bot = SFHLBot(command_prefix="!", intents=intents)


# The one pending debounced refresh task (None when nothing is scheduled).
_pending_top10_refresh: asyncio.Task | None = None


def _schedule_top10_refresh(player_name=None, new_elo=None, new_rank=None):
    """Elo observer: refresh Top 10 roles after any Elo update (registered with
    core.players so DB updates from any cog trigger the role refresh).

    Debounced: refresh_top10_roles does a full guild member scan, so a burst of
    Elo changes (multi-player penalties, repeated /addelo) coalesces into ONE
    refresh ~5s after the first, which reads the then-current standings."""
    global _pending_top10_refresh
    try:
        if _pending_top10_refresh is not None and not _pending_top10_refresh.done():
            return  # already scheduled — it runs after this change lands too

        async def _debounced_refresh():
            await bot.wait_until_ready()
            await asyncio.sleep(5)
            await _refresh_top10_roles(bot)

        _pending_top10_refresh = bot.loop.create_task(_debounced_refresh())
    except Exception:
        logger.exception("Failed to schedule Top10 role refresh")


register_elo_observer(_schedule_top10_refresh)


@bot.event
async def on_ready():
    # Commands are synced in setup_hook (guild-scoped, instant).
    logger.info(f"{bot.user} has connected to Discord!")


def main() -> None:
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError(
            "DISCORD_TOKEN is not set. Copy .env.example to .env and add your bot token."
        )
    bot.run(token)


if __name__ == "__main__":
    main()
