"""Owner/admin utilities: command sync, guild cleanup, and a /help listing."""

import asyncio
import logging

import discord
from discord import app_commands
from discord.ext import commands

from config.settings import GUILD_ID

logger = logging.getLogger(__name__)


class AdminCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    # --- prefix (owner-only) ------------------------------------------------
    @commands.command(name="sync")
    @commands.is_owner()
    async def sync(self, ctx: commands.Context) -> None:
        """Globally sync slash commands."""
        synced = await self.bot.tree.sync()
        await ctx.send(f"Synced {len(synced)} commands globally.")

    @commands.command(name="syncguild")
    @commands.is_owner()
    async def sync_guild(self, ctx: commands.Context, guild_id: int):
        """Sync slash commands for a specific guild."""
        synced = await self.bot.tree.sync(guild=discord.Object(id=guild_id))
        await ctx.send(f"Synced {len(synced)} commands for guild {guild_id}.")

    @commands.command(name="purge_guilds")
    @commands.is_owner()
    async def purge_guilds(self, ctx: commands.Context, confirm: str = None):
        """Leave every guild except the protected one.

        `!purge_guilds` dry-runs; `!purge_guilds confirm` actually leaves them.
        """
        to_leave = [g for g in self.bot.guilds if g.id != GUILD_ID]
        if not to_leave:
            await ctx.send("No guilds to leave (only the protected guild present).")
            return

        summary = "\n".join(
            f"{g.id} — {g.name} ({getattr(g, 'member_count', 'N/A')} members)" for g in to_leave
        )
        await ctx.send(
            f"Will leave {len(to_leave)} guild(s) (protected: {GUILD_ID}):\n{summary}\n\n"
            "If you really want to proceed, run: `!purge_guilds confirm`\n"
            "This is a DRY-RUN unless you pass `confirm`."
        )
        if confirm != "confirm":
            return

        left, failed = [], []
        for guild in to_leave:
            try:
                await guild.leave()
                left.append(guild)
                await asyncio.sleep(0.5)
            except Exception as exc:
                failed.append((guild, repr(exc)))

        report = f"Left {len(left)} guild(s).\n"
        if failed:
            report += f"Failed to leave {len(failed)} guild(s):\n"
            report += "\n".join(f"{g.id} — {g.name}: {err}" for g, err in failed)
        await ctx.send(report)

    # --- /help --------------------------------------------------------------
    @app_commands.command(name="help", description="List the bot's commands by category.")
    async def help_command(self, interaction: discord.Interaction):
        # Group commands by the cog that owns them (falls back to "Other").
        groups: dict[str, list[tuple[str, str]]] = {}
        for cmd in self.bot.tree.walk_commands():
            if not isinstance(cmd, app_commands.Command):
                continue
            cog_name = getattr(getattr(cmd, "binding", None), "qualified_name", None) or "Other"
            label = cog_name.replace("Cog", "")
            groups.setdefault(label, []).append((cmd.name, cmd.description or ""))

        embed = discord.Embed(
            title="SFHL Bot — Commands",
            description="Slash commands grouped by category.",
            color=discord.Color.blurple(),
        )
        for category in sorted(groups):
            lines = "\n".join(f"`/{name}` — {desc}" for name, desc in sorted(groups[category]))
            embed.add_field(name=category, value=lines or "—", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(AdminCog(bot))
