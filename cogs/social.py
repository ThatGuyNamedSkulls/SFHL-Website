"""Social cog: deliver Discord DMs queued by the website.

The website enqueues messages into the shared ``discord_dm_outbox`` table when a
user gets a friend request, a friend accepts, or they're invited to a party
(see the HL website ``lib/social.ts``). Each row's ``to_id`` holds either the
target's **Discord user id** (when the website knows it — the reliable path,
resolved via ``fetch_user``) or, as a fallback, their **player name** which we
resolve to a guild member by display name.

Delivery is best-effort: a row is marked ``sent`` once we attempt it, whether or
not it lands (unknown player, or DMs disabled), so one bad row never wedges the
queue.
"""

import logging

from discord.ext import commands, tasks
import discord

from config.settings import GUILD_ID
from core import db

logger = logging.getLogger(__name__)


class SocialCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.poll_dm_outbox.start()

    def cog_unload(self):
        self.poll_dm_outbox.cancel()

    async def _resolve_by_id(self, user_id: str):
        """Resolve a Discord user id to a User (cache first, then gateway)."""
        if not user_id.isdigit():
            return None
        user = self.bot.get_user(int(user_id))
        if user is None:
            user = await self.bot.fetch_user(int(user_id))
        return user

    async def _resolve_by_name(self, name: str):
        """Resolve a player name to a guild member by display/user name."""
        guild = self.bot.get_guild(GUILD_ID)
        if guild is None:
            return None
        member = discord.utils.find(
            lambda m: m.display_name == name or m.name == name, guild.members
        )
        if member is None:
            # Cache may be incomplete — query the gateway by name.
            found = await guild.query_members(query=name, limit=5)
            member = discord.utils.find(
                lambda m: m.display_name == name or m.name == name, found
            )
        return member

    async def _resolve_target(self, target: str):
        """Resolve an outbox target to a User/Member to DM.

        The website tags each target explicitly — ``id:<discord id>`` or
        ``name:<player name>`` — so an all-numeric player name is never mistaken
        for a Discord id. Legacy untagged rows fall back to the old heuristic
        (all-digits => id, else name).
        """
        if target.startswith("id:"):
            return await self._resolve_by_id(target[3:])
        if target.startswith("name:"):
            return await self._resolve_by_name(target[5:])
        # Legacy untagged row.
        if target.isdigit():
            return await self._resolve_by_id(target)
        return await self._resolve_by_name(target)

    @tasks.loop(seconds=6.0)
    async def poll_dm_outbox(self):
        """Send any unsent DMs the website queued, oldest first."""
        try:
            rows = await db.fetchall(
                "SELECT id, to_id, message FROM discord_dm_outbox "
                "WHERE sent = 0 ORDER BY id ASC LIMIT 20"
            )
        except Exception:
            # Table may not exist yet on a brand-new DB; schema will create it.
            return
        if not rows:
            return

        for row in rows:
            row_id, target, message = row[0], str(row[1]), row[2]
            try:
                user = await self._resolve_target(target)
                if user is None:
                    logger.warning(f"DM {row_id}: could not resolve target '{target}'; marking sent.")
                else:
                    await user.send(message)
                    logger.info(f"Delivered queued DM {row_id} to {target}.")
            except discord.Forbidden:
                logger.info(f"DM {row_id} to {target} blocked (DMs closed); marking sent.")
            except discord.NotFound:
                logger.warning(f"DM {row_id} target '{target}' not found; marking sent.")
            except Exception:
                logger.exception(f"Failed to deliver DM {row_id} to {target}; marking sent.")
            finally:
                # Mark handled regardless so one bad row can't wedge the queue.
                try:
                    await db.execute(
                        "UPDATE discord_dm_outbox SET sent = 1 WHERE id = ?", (row_id,)
                    )
                except Exception:
                    logger.exception(f"Failed to mark DM {row_id} sent.")

    @poll_dm_outbox.before_loop
    async def _before(self):
        # Don't poll until the gateway is connected and the member cache is warm.
        await self.bot.wait_until_ready()


async def setup(bot: commands.Bot):
    await bot.add_cog(SocialCog(bot))
