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
        """Syncs all guild members' Discord ID, username (@handle) and avatar URL
        into their players row (keyed by display_name, the Roblox username).

        The avatar URL is stored so the website can show a real profile picture
        without hitting the Discord API per leaderboard row (the bot's local
        Roblox avatar files aren't deployed to Vercel, so those URLs 404 there
        and the UI fell back to initials).

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
                # profile name (= players.name). display_avatar falls back to the
                # default embed avatar when they have no custom one.
                avatar = str(member.display_avatar.replace(format="png", size=256))
                stmts.append((
                    """UPDATE players SET discord_id = ?, discord_username = ?,
                              discord_avatar = ?
                       WHERE name = ? AND (discord_id IS NOT ? OR discord_username IS NOT ?
                                           OR discord_avatar IS NOT ?)""",
                    (member.id, member.name, avatar, member.display_name,
                     member.id, member.name, avatar),
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
