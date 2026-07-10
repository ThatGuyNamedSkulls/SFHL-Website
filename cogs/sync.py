"""Background tasks for keeping external data synced with the database."""

import logging

from discord.ext import commands, tasks

from config.settings import GUILD_ID
from core import db

logger = logging.getLogger(__name__)


class SyncCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.sync_discord_identities.start()

    def cog_unload(self):
        self.sync_discord_identities.cancel()

    @tasks.loop(hours=1)
    async def sync_discord_identities(self):
        """Syncs all guild members' Discord ID and username (@handle) into their
        players row (keyed by display_name, which is the Roblox username).

        Uses fetch_members (authoritative — the local member cache can be empty
        or partial right after startup), only writes rows whose values actually
        changed, and chunks the batch to avoid oversized transactions.
        """
        guild = self.bot.get_guild(GUILD_ID)
        if not guild:
            logger.warning("Sync loop: Could not find configured GUILD_ID. Skipping.")
            return

        try:
            stmts = []
            async for member in guild.fetch_members(limit=None):
                # member.name is the @handle, member.display_name is the server
                # profile name (= players.name).
                stmts.append((
                    """UPDATE players SET discord_id = ?, discord_username = ?
                       WHERE name = ? AND (discord_id IS NOT ? OR discord_username IS NOT ?)""",
                    (member.id, member.name, member.display_name, member.id, member.name),
                ))
            for i in range(0, len(stmts), 100):
                await db.batch(stmts[i:i + 100])
            logger.info(f"Synced Discord identities for {len(stmts)} guild members.")
        except Exception:
            logger.exception("Failed to sync Discord identities.")

    @sync_discord_identities.before_loop
    async def _before_sync(self):
        await self.bot.wait_until_ready()


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(SyncCog(bot))
