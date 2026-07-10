"""Progression commands: achievements, badges, and seasonal rewards.

Achievement *tracking* logic lives in core.achievements (shared with /rank);
this cog owns the user-facing commands and the periodic badge-granting task.
"""

import logging

import discord
from discord import app_commands
from discord.ext import commands, tasks

from core import db
from core.achievements import display_player_achievements
from core.cosmetics import sync_top10_badge

logger = logging.getLogger(__name__)


async def grant_badges():
    """Grant milestone badges (e.g. 10-Win Streak) to qualifying players."""
    try:
        for (player_name,) in await db.fetchall(
            "SELECT name FROM players WHERE matches_won >= 10"
        ):
            exists = await db.fetchone(
                "SELECT 1 FROM badges WHERE player_name = ? AND badge_name = ?",
                (player_name, "10-Win Streak"),
            )
            if not exists:
                await db.execute(
                    "INSERT INTO badges (player_name, badge_name) VALUES (?, ?)",
                    (player_name, "10-Win Streak"),
                )
    except Exception as e:
        logger.error(f"Failed to update badges: {e}")


class ProgressionCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # The original task never started (its .start() was mis-indented inside
        # the task body). Start it correctly here.
        self.update_badges.start()

    def cog_unload(self):
        self.update_badges.cancel()

    @tasks.loop(hours=1)
    async def update_badges(self):
        await grant_badges()
        # Keep the dynamic "Top 10 — Current Season" cosmetic badge in sync
        # with the live standings (grants entrants, revokes drop-outs).
        # (Discord-identity syncing is owned by cogs/sync.py's SyncCog.)
        try:
            await sync_top10_badge()
        except Exception:
            logger.exception("Failed to sync the Top 10 cosmetic badge")

    @update_badges.before_loop
    async def _before_update_badges(self):
        await self.bot.wait_until_ready()

    @app_commands.command(name="checkachievements", description="Check a player's achievements.")
    async def check_achievements(self, interaction: discord.Interaction, player_name: str):
        embed = discord.Embed(
            title=f"Achievements for {player_name}",
            description=await display_player_achievements(player_name),
            color=discord.Color.gold(),
        )
        await interaction.response.send_message(embed=embed)

    @app_commands.command(
        name="givebadge", description="Give a badge to all players in the database."
    )
    async def give_badge(self, interaction: discord.Interaction, badge_name: str):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                "You don't have permission to use this command.", ephemeral=True
            )
            return
        try:
            await db.execute(
                """INSERT INTO badges (player_name, badge_name)
                   SELECT name, ? FROM players
                   WHERE NOT EXISTS (
                       SELECT 1 FROM badges
                       WHERE badges.player_name = players.name AND badges.badge_name = ?
                   )""",
                (badge_name, badge_name),
            )
            embed = discord.Embed(
                title="Badge Granted",
                description=f"The badge '{badge_name}' has been granted to all players.",
                color=discord.Color.green(),
            )
            await interaction.response.send_message(embed=embed)
            logger.info(f"The badge '{badge_name}' has been granted to all players.")
        except Exception as e:
            logger.error(f"Failed to grant badge '{badge_name}' to all players: {e}")
            await interaction.response.send_message(
                "An error occurred while granting the badge. Please try again later.",
                ephemeral=True,
            )

    @app_commands.command(name="addbadge", description="Add a badge to a specific player.")
    async def add_badge(self, interaction: discord.Interaction, player_name: str, badge_name: str):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                "You don't have permission to use this command.", ephemeral=True
            )
            return
        try:
            await db.execute(
                "INSERT INTO badges (player_name, badge_name) VALUES (?, ?)",
                (player_name, badge_name),
            )
            embed = discord.Embed(
                title="Badge Added",
                description=f"The badge '{badge_name}' has been added to {player_name}.",
                color=discord.Color.green(),
            )
            await interaction.response.send_message(embed=embed)
            logger.info(f"The badge '{badge_name}' has been added to {player_name}.")
        except Exception as e:
            logger.error(f"Failed to add badge '{badge_name}' to {player_name}: {e}")
            await interaction.response.send_message(
                "An error occurred while adding the badge. Please try again later.", ephemeral=True
            )

    @app_commands.command(name="removebadge", description="Remove a badge from a specific player.")
    async def remove_badge(
        self, interaction: discord.Interaction, player_name: str, badge_name: str
    ):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                "You don't have permission to use this command.", ephemeral=True
            )
            return
        try:
            result = await db.execute(
                "DELETE FROM badges WHERE player_name = ? AND badge_name = ?",
                (player_name, badge_name),
            )
            removed = result.rows_affected
            if removed > 0:
                embed = discord.Embed(
                    title="Badge Removed",
                    description=f"The badge '{badge_name}' has been removed from {player_name}.",
                    color=discord.Color.green(),
                )
                await interaction.response.send_message(embed=embed)
                logger.info(f"The badge '{badge_name}' has been removed from {player_name}.")
            else:
                await interaction.response.send_message(
                    f"The player {player_name} does not have the badge '{badge_name}'.",
                    ephemeral=True,
                )
        except Exception as e:
            logger.error(f"Failed to remove badge '{badge_name}' from {player_name}: {e}")
            await interaction.response.send_message(
                "An error occurred while removing the badge. Please try again later.",
                ephemeral=True,
            )

    @app_commands.command(
        name="add_seasonal_reward", description="Add a seasonal reward for a player (Admin-only)."
    )
    async def add_seasonal_reward(
        self, interaction: discord.Interaction, player_name: str, reward: str
    ):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                "You don't have permission to use this command.", ephemeral=True
            )
            return
        await db.execute(
            "UPDATE players SET season_rewards = season_rewards || ? || ', ' WHERE name = ?",
            (reward, player_name),
        )
        await interaction.response.send_message(f"Added reward '{reward}' to {player_name}.")

    @app_commands.command(
        name="remove_seasonal_reward",
        description="Remove a seasonal reward from a specific player.",
    )
    async def remove_seasonal_reward(
        self, interaction: discord.Interaction, player_name: str, reward: str
    ):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                "You don't have permission to use this command.", ephemeral=True
            )
            return
        row = await db.fetchone(
            "SELECT season_rewards FROM players WHERE name = ?", (player_name,)
        )
        if not row:
            await interaction.response.send_message(
                f"The player {player_name} does not exist in the database.", ephemeral=True
            )
            return
        rewards_list = row[0].split(", ")
        if reward in rewards_list:
            rewards_list.remove(reward)
            await db.execute(
                "UPDATE players SET season_rewards = ? WHERE name = ?",
                (", ".join(rewards_list), player_name),
            )
            await interaction.response.send_message(
                f"Removed reward '{reward}' from {player_name}."
            )
        else:
            await interaction.response.send_message(
                f"The player {player_name} does not have the reward '{reward}'.", ephemeral=True
            )


async def setup(bot: commands.Bot):
    await bot.add_cog(ProgressionCog(bot))
