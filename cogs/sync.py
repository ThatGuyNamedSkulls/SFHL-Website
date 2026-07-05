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
        players row (keyed by display_name, which is the Roblox username)."""
        await self.bot.wait_until_ready()
        
        guild = self.bot.get_guild(GUILD_ID)
        if not guild:
            logger.warning("Sync loop: Could not find configured GUILD_ID. Skipping.")
            return

        updates = []
        for member in guild.members:
            # member.name is the @handle, member.display_name is the server profile name.
            updates.append((member.id, member.name, member.display_name))

        if not updates:
            return

        try:
            # Batch update players where the db name matches their display_name
            await db.batch(
                [
                    (
                        "UPDATE players SET discord_id = ?, discord_username = ? WHERE name = ?",
                        (uid, uname, display_name),
                    )
                    for uid, uname, display_name in updates
                ]
            )
            logger.info(f"Synced Discord identities for {len(updates)} guild members.")
        except Exception:
            logger.exception("Failed to sync Discord identities.")


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(SyncCog(bot))
