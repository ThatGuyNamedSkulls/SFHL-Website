"""/profile — renders a player's stats card image.

Data is gathered asynchronously (DB + Roblox avatar), the Elo graph and the PIL
card are rendered off the event loop (asyncio.to_thread), then sent.
"""

import asyncio
import logging

import discord
from discord import app_commands
from discord.ext import commands

from core import db
from core.ranks import get_rank, get_expected_range
from core.roblox import get_roblox_user_id, get_or_download_roblox_avatar
from rendering.elo_graph import render_elo_graph
from rendering.profile_card import build_profile_image, calculate_rating

logger = logging.getLogger(__name__)


class ProfileCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="profile", description="Shows your profile")
    async def profile(self, interaction: discord.Interaction, player_name: str = None):
        if player_name is None:
            player_name = interaction.user.display_name
        await interaction.response.defer()

        player_info = await db.fetchone(
            """SELECT name, elo, rank, total_kills, total_deaths, total_assists, kd_ratio,
                      total_mvps, total_score, avg_hs_percent, matches_played, matches_won,
                      roblox_avatar_image, roblox_user_id, total_play_time, peak_elo
               FROM players WHERE name = ?""",
            (player_name,),
        )
        if not player_info:
            await interaction.followup.send(f"Player '{player_name}' not found.", ephemeral=True)
            return
        profile_color_row = await db.fetchone(
            "SELECT profile_color FROM players WHERE name = ?", (player_name,)
        )
        recent_for_rating = await db.fetchall(
            """SELECT points, kills, deaths, mvps FROM match_history
               WHERE player_name = ? ORDER BY timestamp DESC LIMIT 10""",
            (player_name,),
        )
        match_history = await db.fetchall(
            """SELECT id, result, elo_change, map_name, region, kills, deaths, assists, hs_percentage
               FROM match_history WHERE player_name = ? ORDER BY timestamp DESC LIMIT 5""",
            (player_name,),
        )

        (name, elo, rank, total_kills, total_deaths, total_assists, kd_ratio, total_mvps,
         total_score, avg_hs_percent, matches_played, matches_won, roblox_avatar_image,
         roblox_user_id, total_play_time, peak_elo) = player_info

        # HL rating from recent (<=10) matches.
        rank_min, rank_max = get_expected_range(rank)
        if recent_for_rating:
            n = len(recent_for_rating)
            avg_score = sum(m[0] or 0 for m in recent_for_rating) / n
            avg_kills = sum(m[1] or 0 for m in recent_for_rating) / n
            avg_deaths = sum(m[2] or 0 for m in recent_for_rating) / n
            avg_mvps = sum(m[3] or 0 for m in recent_for_rating) / n
            hl_rating = calculate_rating(avg_score, rank_min, rank_max, avg_kills, avg_deaths, avg_mvps, n)
        else:
            hl_rating = 0

        # Use TOTAL matches for these (the original overwrote matches_played with the
        # recent-match count, which made these wrong — fixed here).
        kd_ratio = (total_kills / total_deaths) if total_deaths > 0 else total_kills
        win_percent = (matches_won / matches_played * 100) if matches_played > 0 else 0
        avg_score_per_game = (total_score / matches_played) if matches_played > 0 else 0

        # Avatar (downloaded/cached) + thumbnail.
        local_avatar_path = None
        discord_avatar_file = None
        roblox_uid = await get_roblox_user_id(player_name)
        if roblox_uid:
            local_avatar_path = await get_or_download_roblox_avatar(player_name, roblox_uid)
            if local_avatar_path:
                discord_avatar_file = discord.File(local_avatar_path, filename="avatar.png")

        # Elo trend graph (off the event loop).
        graph_ok = await render_elo_graph(player_name, "elo_graph.png")

        data = {
            "name": name, "elo": elo, "rank": rank, "peak_elo": peak_elo,
            "total_kills": total_kills, "total_deaths": total_deaths,
            "total_assists": total_assists, "total_mvps": total_mvps,
            "avg_hs_percent": avg_hs_percent, "matches_played": matches_played,
            "matches_won": matches_won, "total_play_time": total_play_time,
            "kd_ratio": kd_ratio, "win_percent": win_percent,
            "avg_score_per_game": avg_score_per_game, "hl_rating": hl_rating,
            "match_history": match_history, "local_avatar_path": local_avatar_path,
            "graph_path": "elo_graph.png" if graph_ok else None,
        }

        # Build the card image off the event loop.
        output_path = await asyncio.to_thread(build_profile_image, data)
        if output_path is None:
            await interaction.followup.send(
                "Error: `RedGUI.png` template not found.", ephemeral=True
            )
            return

        try:
            color_value = int(profile_color_row[0].lstrip("#"), 16) if profile_color_row and profile_color_row[0] else 0x000000
        except Exception:
            color_value = 0x000000

        embed = discord.Embed(
            title="# Player Profile", colour=color_value or discord.Colour.red()
        )
        embed.set_image(url="attachment://RedGUI.png")
        embed.add_field(name="Elo", value=elo, inline=True)
        embed.add_field(name="Rank", value=rank, inline=True)
        embed.add_field(name="HL Rating", value=hl_rating, inline=True)
        embed.set_author(
            name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url
        )
        if discord_avatar_file:
            embed.set_thumbnail(url="attachment://avatar.png")

        files = [discord.File(output_path, filename="RedGUI.png")]
        if discord_avatar_file:
            files.append(discord_avatar_file)
        await interaction.followup.send(embed=embed, files=files)


async def setup(bot: commands.Bot):
    await bot.add_cog(ProfileCog(bot))
