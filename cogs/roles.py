"""Top 10 role maintenance, shared by the ranking cog and the Elo observer.

Takes the bot explicitly (rather than importing a global) so it can be called
from a cog (`self.bot`) or from main.py's Elo observer without a circular import.
"""

import logging

import discord

from config.settings import GUILD_ID, TOP10_ROLE_NAME, TOP10_MIN_ELO, TOP10_COUNT
from core import db

logger = logging.getLogger(__name__)


async def refresh_top10_roles(bot) -> None:
    """Assign the Top 10 role to exactly the current top-Elo qualifying players."""
    try:
        top_rows = await db.fetchall(
            "SELECT name, elo FROM players ORDER BY elo DESC, matches_won DESC LIMIT ?",
            (TOP10_COUNT,),
        )
        # elo > 0 guard: right after a season reset everyone sits at 0 Elo, and
        # without it the role would go to 10 arbitrary players (mirrors the
        # same guard in core.cosmetics.sync_top10_badge).
        top_set = {row[0] for row in top_rows if row[1] >= TOP10_MIN_ELO and row[1] > 0}

        guild = bot.get_guild(GUILD_ID)
        if guild is None:
            logger.warning("Guild not found when refreshing Top10 roles")
            return

        role = discord.utils.get(guild.roles, name=TOP10_ROLE_NAME)
        if role is None:
            try:
                role = await guild.create_role(
                    name=TOP10_ROLE_NAME, reason="Top10 role auto-created"
                )
                logger.info(f"Created role {TOP10_ROLE_NAME} in guild {guild.id}")
            except Exception:
                logger.exception("Failed to create Top10 role")
                return

        async for member in guild.fetch_members(limit=None):
            should_have = member.display_name in top_set
            has_role = role in member.roles
            if should_have and not has_role:
                try:
                    await member.add_roles(role, reason="Promoted to Top 10")
                except Exception:
                    logger.exception(f"Failed to add Top10 role to {member.display_name}")
            elif not should_have and has_role:
                try:
                    await member.remove_roles(role, reason="No longer Top 10")
                except Exception:
                    logger.exception(f"Failed to remove Top10 role from {member.display_name}")
    except Exception:
        logger.exception("Unexpected error while refreshing Top10 roles")
