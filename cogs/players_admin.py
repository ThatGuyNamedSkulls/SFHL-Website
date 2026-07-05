"""Player management & profile-lite commands.

addplayer, removeplayer, renameplayer, checkplayer, leaderboard,
setcolor, checkperformance. Uses core.db.connect (no shared global cursor).

Titles are no longer self-set here (/settitle was removed): they're
admin-granted cosmetic items equipped on the website, which mirrors the
equipped title into players.title (see core/cosmetics.py).
"""

import logging

import discord
from discord import app_commands
from discord.ext import commands
from discord.ui import View, Button

from core import db
from core.ranks import RANK_THRESHOLDS, get_rank, get_expected_range
from core.players import get_player_elo
from core.roblox import get_roblox_user_id, get_roblox_avatar_url
from cogs.shared import has_required_role, player_name_choices as _player_choices
from cogs.roles import refresh_top10_roles

logger = logging.getLogger(__name__)


class LeaderboardView(View):
    def __init__(self, entries, per_page=10):
        super().__init__(timeout=None)
        self.entries = entries
        self.per_page = per_page
        self.current_page = 0

    def get_page_content(self):
        start = self.current_page * self.per_page
        page_entries = self.entries[start:start + self.per_page]
        embed = discord.Embed(
            title="Leaderboard",
            description=f"Page {self.current_page + 1} / {((len(self.entries) - 1) // self.per_page) + 1}",
            color=discord.Color.gold(),
        )
        for i, (name, elo, rank, matches_won) in enumerate(page_entries, start=start + 1):
            embed.add_field(
                name=f"{i}. {name}",
                value=f"Elo: {elo} | Rank: {rank} | Matches Won: {matches_won}",
                inline=False,
            )
        return embed

    async def update_message(self, interaction):
        await interaction.response.edit_message(embed=self.get_page_content(), view=self)

    @discord.ui.button(label="Previous Page", style=discord.ButtonStyle.primary)
    async def previous_page(self, interaction: discord.Interaction, button: Button):
        if self.current_page > 0:
            self.current_page -= 1
            await self.update_message(interaction)

    @discord.ui.button(label="Next Page", style=discord.ButtonStyle.primary)
    async def next_page(self, interaction: discord.Interaction, button: Button):
        if (self.current_page + 1) * self.per_page < len(self.entries):
            self.current_page += 1
            await self.update_message(interaction)


class PlayersCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="addplayer", description="Add one or more players (comma-separated, Elo auto set to 0)."
    )
    async def add_player(self, interaction: discord.Interaction, player_names: str):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        added, already_exists, too_long = [], [], []
        for player_name in (n.strip() for n in player_names.split(",")):
            if len(player_name) > 20:
                too_long.append(player_name)
                continue
            if await db.fetchone(
                "SELECT name FROM players WHERE name = ?", (player_name,)
            ) is not None:
                already_exists.append(player_name)
                continue
            await db.execute(
                "INSERT INTO players (name, elo, rank) VALUES (?, ?, ?)",
                (player_name, 0, get_rank(0)),
            )
            added.append(player_name)

        embed = discord.Embed(title="Add Players Result", color=discord.Color.gold())
        if added:
            embed.add_field(name="Added", value=", ".join(added), inline=False)
        if already_exists:
            embed.add_field(name="Already Exists", value=", ".join(already_exists), inline=False)
        if too_long:
            embed.add_field(name="Name Too Long", value=", ".join(too_long), inline=False)
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="removeplayer", description="Remove a player from the database.")
    async def remove_player(self, interaction: discord.Interaction, player_name: str):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        try:
            if await db.fetchone(
                "SELECT name FROM players WHERE name = ?", (player_name,)
            ) is None:
                await interaction.response.send_message(
                    f"Player '{player_name}' not found in the database.", ephemeral=True
                )
                return
            # Remove the player everywhere their name is stored so no orphaned rows
            # survive — the delete-side mirror of /renameplayer's updates: the bot's
            # own tables AND the name-keyed website social tables, plus the queue and
            # the per-season stat archive. One batch so it all goes together.
            # (Moderation records in timeouts/warnings/leaving_incidents are keyed by
            # Discord id, not name, and are intentionally left intact — same as
            # /renameplayer, which never touches them.)
            await db.batch([
                ("DELETE FROM players WHERE name = ?", (player_name,)),
                ("DELETE FROM match_history WHERE player_name = ?", (player_name,)),
                ("DELETE FROM achievements WHERE player_name = ?", (player_name,)),
                ("DELETE FROM badges WHERE player_name = ?", (player_name,)),
                ("DELETE FROM cosmetic_inventory WHERE player_name = ?", (player_name,)),
                ("DELETE FROM season_stats WHERE player_name = ?", (player_name,)),
                ("DELETE FROM reports WHERE reporter_name = ?", (player_name,)),
                ("DELETE FROM reports WHERE reported_user = ?", (player_name,)),
                ("DELETE FROM web_queue WHERE player_name = ?", (player_name,)),
                ("DELETE FROM web_users WHERE player_name = ?", (player_name,)),
                ("DELETE FROM friendships WHERE user_a = ? OR user_b = ?", (player_name, player_name)),
                ("DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?", (player_name, player_name)),
                ("DELETE FROM party_invites WHERE from_id = ? OR to_id = ?", (player_name, player_name)),
                ("DELETE FROM notifications WHERE user_id = ? OR actor_id = ?", (player_name, player_name)),
                ("DELETE FROM discord_dm_outbox WHERE to_id = ?", (player_name,)),
            ])
            embed = discord.Embed(
                title="Player Removed",
                description=f"Player '{player_name}' has been removed from the database.",
                color=discord.Color.red(),
            )
            await interaction.response.send_message(embed=embed)
            logger.info(f"Player '{player_name}' removed from the database.")
        except Exception as e:
            logger.error(f"Failed to remove player '{player_name}': {e}")
            await interaction.response.send_message(
                f"An error occurred while trying to remove player '{player_name}'.", ephemeral=True
            )

    @remove_player.autocomplete("player_name")
    async def _remove_player_ac(self, interaction: discord.Interaction, current: str):
        return await _player_choices(current)

    @app_commands.command(
        name="renameplayer",
        description="Rename a player in the database without losing associated data.",
    )
    async def rename_player(self, interaction: discord.Interaction, old_name: str, new_name: str):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have permission to rename players.", ephemeral=True
            )
            return
        old_name, new_name = old_name.strip(), new_name.strip()
        if not old_name or not new_name:
            await interaction.response.send_message(
                "Both old and new names must be provided.", ephemeral=True
            )
            return
        if old_name == new_name:
            await interaction.response.send_message(
                "The new name is the same as the old name.", ephemeral=True
            )
            return
        try:
            if await db.fetchone(
                "SELECT id FROM players WHERE name = ?", (old_name,)
            ) is None:
                await interaction.response.send_message(
                    f"Player '{old_name}' not found in the database.", ephemeral=True
                )
                return
            if await db.fetchone(
                "SELECT id FROM players WHERE name = ?", (new_name,)
            ):
                await interaction.response.send_message(
                    f"A player with the name '{new_name}' already exists.", ephemeral=True
                )
                return
            # Update every table that keys on the player name — the bot's own
            # tables AND the name-keyed website social tables — so a rename
            # doesn't orphan badges, friends, invites, notifications or queued
            # DMs. Wrapped in one batch so it all moves together.
            await db.batch([
                ("UPDATE players SET name = ? WHERE name = ?", (new_name, old_name)),
                ("UPDATE match_history SET player_name = ? WHERE player_name = ?", (new_name, old_name)),
                ("UPDATE achievements SET player_name = ? WHERE player_name = ?", (new_name, old_name)),
                ("UPDATE badges SET player_name = ? WHERE player_name = ?", (new_name, old_name)),
                # Cosmetic inventory (catalog isn't name-keyed; equipped state
                # rides on the inventory row, so this one statement covers it).
                ("UPDATE cosmetic_inventory SET player_name = ? WHERE player_name = ?", (new_name, old_name)),
                ("UPDATE reports SET reporter_name = ? WHERE reporter_name = ?", (new_name, old_name)),
                ("UPDATE reports SET reported_user = ? WHERE reported_user = ?", (new_name, old_name)),
                # Website social tables (all keyed on player name).
                ("UPDATE web_users SET player_name = ? WHERE player_name = ?", (new_name, old_name)),
                ("UPDATE friendships SET user_a = ? WHERE user_a = ?", (new_name, old_name)),
                ("UPDATE friendships SET user_b = ? WHERE user_b = ?", (new_name, old_name)),
                # Re-normalize any pair the rename knocked out of sorted order,
                # so areFriends()'s canonical (min,max) lookup still matches.
                ("UPDATE friendships SET user_a = user_b, user_b = user_a WHERE user_a > user_b", ()),
                ("UPDATE friend_requests SET from_id = ? WHERE from_id = ?", (new_name, old_name)),
                ("UPDATE friend_requests SET to_id = ? WHERE to_id = ?", (new_name, old_name)),
                ("UPDATE party_invites SET from_id = ? WHERE from_id = ?", (new_name, old_name)),
                ("UPDATE party_invites SET to_id = ? WHERE to_id = ?", (new_name, old_name)),
                ("UPDATE notifications SET user_id = ? WHERE user_id = ?", (new_name, old_name)),
                ("UPDATE notifications SET actor_id = ? WHERE actor_id = ?", (new_name, old_name)),
                ("UPDATE discord_dm_outbox SET to_id = ? WHERE to_id = ?", (new_name, old_name)),
            ])
            await interaction.response.send_message(
                f"Player renamed from '{old_name}' to '{new_name}' successfully.", ephemeral=True
            )
            logger.info(f"Player renamed: '{old_name}' -> '{new_name}' by {interaction.user}")
            try:
                await refresh_top10_roles(self.bot)
            except Exception:
                logger.exception("Failed to refresh Top10 roles after rename")
        except Exception as e:
            logger.error(f"Database error during rename: {e}")
            await interaction.response.send_message(
                "An error occurred while renaming the player.", ephemeral=True
            )

    @app_commands.command(name="checkplayer", description="Check the detailed profile of a player.")
    async def check_player(self, interaction: discord.Interaction, player_name: str = None):
        if player_name is None:
            player_name = interaction.user.display_name
        # Defer first: this command makes Roblox API calls below, which can take
        # longer than Discord's 3s interaction window.
        await interaction.response.defer()
        try:
            player = await db.fetchone(
                """SELECT name, elo, rank, matches_played, matches_won, placement_games_played,
                          title, profile_color, season_rewards
                   FROM players WHERE name = ?""",
                (player_name,),
            )
            if not player:
                await interaction.followup.send(
                    f"Player '{player_name}' not found.", ephemeral=True
                )
                return
            (name, elo, rank, matches_played, matches_won, placement_games_played,
             title, profile_color, season_rewards) = player

            names = [
                r[0] for r in await db.fetchall(
                    "SELECT name FROM players ORDER BY elo DESC, matches_won DESC, matches_played ASC"
                )
            ]
            badges = [
                r[0] for r in await db.fetchall(
                    "SELECT badge_name FROM badges WHERE player_name = ?", (player_name,)
                )
            ]

            standing = names.index(name) + 1 if name in names else "N/A"
            try:
                color_value = int(profile_color.lstrip("#"), 16) if profile_color else 0x000000
            except Exception:
                color_value = 0x000000

            embed = discord.Embed(
                title=f"#{standing} Profile: {name}",
                description=(title or "Equip a title at sf-hl.com/settings!"),
                color=color_value,
            )
            embed.add_field(name="Elo", value=str(elo), inline=True)
            embed.add_field(name="Rank", value=str(rank), inline=True)

            if rank == "[?] Unranked":
                embed.add_field(
                    name="Placement Progress",
                    value=f"{placement_games_played}/3 placement games played",
                    inline=False,
                )
            else:
                idx = next((i for i, t in enumerate(RANK_THRESHOLDS) if t[2] == rank), None)
                if idx is not None and idx + 1 < len(RANK_THRESHOLDS):
                    next_threshold, _, next_rank_name = RANK_THRESHOLDS[idx + 1]
                    embed.add_field(
                        name="Next Rank",
                        value=f"{next_rank_name} ({next_threshold - elo} Elo needed)",
                        inline=False,
                    )
                else:
                    embed.add_field(name="Next Rank", value="Max Rank Achieved", inline=False)

            win_rate = (matches_won / matches_played * 100) if matches_played else 0
            embed.add_field(name="Matches Played", value=str(matches_played), inline=True)
            embed.add_field(name="Matches Won", value=str(matches_won), inline=True)
            embed.add_field(name="Win Rate", value=f"{win_rate:.2f}%", inline=True)
            if season_rewards:
                embed.add_field(name="Season Rewards", value=season_rewards, inline=False)
            if badges:
                embed.add_field(name="Badges", value=", ".join(badges), inline=False)

            roblox_user_id = await get_roblox_user_id(player_name)
            avatar_url = await get_roblox_avatar_url(roblox_user_id) if roblox_user_id else None
            if avatar_url:
                embed.set_thumbnail(url=avatar_url)

            await interaction.followup.send(embed=embed)
        except Exception as e:
            logger.error(f"Error fetching player data: {e}")
            await interaction.followup.send(
                "An error occurred while fetching player data.", ephemeral=True
            )

    @check_player.autocomplete("player_name")
    async def _check_player_ac(self, interaction: discord.Interaction, current: str):
        return await _player_choices(current)

    @app_commands.command(name="leaderboard", description="Show the current season leaderboard.")
    async def leaderboard(self, interaction: discord.Interaction):
        rows = await db.fetchall(
            "SELECT name, elo, rank, matches_won FROM players ORDER BY elo DESC"
        )
        if not rows:
            await interaction.response.send_message("The leaderboard is empty.", ephemeral=True)
            return
        view = LeaderboardView(rows)
        await interaction.response.send_message(
            embed=view.get_page_content(), view=view, ephemeral=True
        )

    @app_commands.command(
        name="setcolor",
        description="Set profile color for yourself. Remember to type # before the hex code!",
    )
    async def setcolor(self, interaction: discord.Interaction, player_name: str, hex_color: str):
        if player_name.lower() != interaction.user.display_name.lower():
            await interaction.response.send_message(
                "You can only set a color theme to yourself.", ephemeral=True
            )
            return
        await db.execute(
            "UPDATE players SET profile_color = ? WHERE name = ?", (hex_color, player_name)
        )
        await interaction.response.send_message(
            f"Set profile color for {player_name} to {hex_color}."
        )

    @app_commands.command(
        name="checkperformance",
        description="Check a player's recent performance relative to their rank.",
    )
    async def check_performance(self, interaction: discord.Interaction, player_name: str = None):
        if player_name is None:
            player_name = interaction.user.display_name
        try:
            current_elo = await get_player_elo(player_name)
            if current_elo is None:
                await interaction.response.send_message(
                    f"Player '{player_name}' not found.", ephemeral=True
                )
                return
            current_rank = get_rank(current_elo)

            recent_matches = await db.fetchall(
                """SELECT points, result, timestamp FROM match_history
                   WHERE player_name = ? AND COALESCE(is_placement, 0) = 0
                   ORDER BY timestamp DESC LIMIT 10""",
                (player_name,),
            )
            if len(recent_matches) < 3:
                await interaction.response.send_message(
                    f"Not enough match history for {player_name} (need at least 3 games).",
                    ephemeral=True,
                )
                return

            recent_points = [m[0] for m in recent_matches]
            avg_recent_points = sum(recent_points) / len(recent_points)
            expected_min, expected_max = get_expected_range(current_rank)
            expected_avg = (expected_min + expected_max) / 2
            ratio = avg_recent_points / expected_avg

            if ratio < 0.15:
                status, description = "⚫ Unusual Underperforming", "You are unusually underperforming. Consider taking a break and reviewing your gameplay."
            elif ratio < 0.5:
                status, description = "⚫ Underperforming", "You are underperforming. Consider focusing on fundamentals."
            elif ratio < 0.7:
                status, description = "🔴 Significantly Underperforming", "You are playing well below expectations. Consider reviewing your gameplay."
            elif ratio < 0.85:
                status, description = "🟡 Moderately Underperforming", "You are slightly below expectations. Focus on improving key areas."
            elif ratio < 0.92:
                status, description = "🟡 Slightly Underperforming", "You are just below expectations. Nothing to worry about, but a little more effort can help."
            elif ratio > 2.0:
                status, description = "🟣 Exceptional Overperformance", "Wow! You are performing exceptionally well! Quick rank up ahead!"
            elif ratio > 1.5:
                status, description = "🟣 Overperforming", "Wow! You are performing very well! Quick rank up ahead!"
            elif ratio > 1.3:
                status, description = "🟢 Significantly Overperforming", "You are exceeding expectations! Keep up the great work."
            elif ratio > 1.15:
                status, description = "🟢 Moderately Overperforming", "You are performing above expectations. Great job!"
            elif ratio > 1.08:
                status, description = "🟢 Slightly Overperforming", "You are just above expectations. Keep it up!"
            else:
                status, description = "⚪ Normal Performance", "You are performing as expected for your rank."

            embed = discord.Embed(
                title=f"Performance Analysis: {player_name}", color=discord.Color.blue()
            )
            embed.add_field(name="Current Rank", value=current_rank, inline=True)
            embed.add_field(name="Current Elo", value=str(current_elo), inline=True)
            embed.add_field(name="Recent Games", value=str(len(recent_matches)), inline=True)
            embed.add_field(name="Average Recent Points", value=f"{avg_recent_points:.1f}", inline=True)
            embed.add_field(name="Expected Range", value=f"{expected_min}-{expected_max}", inline=True)
            embed.add_field(name="Performance Ratio", value=f"{ratio:.2f}x", inline=True)
            embed.add_field(name="Historical Status", value=status, inline=False)
            embed.add_field(name="Description", value=description, inline=False)
            await interaction.response.send_message(embed=embed)
        except Exception as e:
            logger.error(f"Error in check_performance: {e}")
            await interaction.response.send_message(
                "An error occurred while analyzing performance.", ephemeral=True
            )

    @check_performance.autocomplete("player_name")
    async def _check_performance_ac(self, interaction: discord.Interaction, current: str):
        return await _player_choices(current)

    @app_commands.command(name="matchhistory", description="Show a player's recent matches.")
    async def matchhistory(self, interaction: discord.Interaction, player_name: str = None):
        if player_name is None:
            player_name = interaction.user.display_name
        rows = await db.fetchall(
            """SELECT result, elo_change, map_name, region, kills, deaths, assists,
                      hs_percentage, points, timestamp, match_id
               FROM match_history WHERE player_name = ? AND COALESCE(is_placement, 0) = 0
               ORDER BY timestamp DESC LIMIT 10""",
            (player_name,),
        )
        if not rows:
            await interaction.response.send_message(
                f"No match history for '{player_name}'.", ephemeral=True
            )
            return
        embed = discord.Embed(title=f"Match History: {player_name}", color=discord.Color.blue())
        for result, elo_change, map_name, region, k, d, a, hs, points, ts, match_id in rows:
            sign = "+" if (elo_change or 0) >= 0 else ""
            header = f"{result or '—'}  ({sign}{elo_change or 0} Elo)"
            value = (
                f"{map_name or '—'} · {region or '—'} · "
                f"KDA {k or 0}/{d or 0}/{a or 0} · {points or 0} pts · HS {hs or 0}%"
                f"\nMatch ID: `{match_id if match_id is not None else '—'}`"
            )
            embed.add_field(name=header, value=value, inline=False)
        await interaction.response.send_message(embed=embed)

    @matchhistory.autocomplete("player_name")
    async def _matchhistory_ac(self, interaction: discord.Interaction, current: str):
        return await _player_choices(current)

    @app_commands.command(
        name="seasonstats",
        description="Show a player's archived stats from a past season (see /resetdb).",
    )
    async def season_stats(
        self, interaction: discord.Interaction, season_name: str, player_name: str = None
    ):
        if player_name is None:
            player_name = interaction.user.display_name
        row = await db.fetchone(
            """SELECT elo, rank, matches_played, matches_won, total_kills, total_deaths,
                      total_assists, kd_ratio, total_mvps, total_score, avg_hs_percent,
                      total_play_time, peak_elo
               FROM season_stats WHERE season_name = ? AND player_name = ?""",
            (season_name, player_name),
        )
        if not row:
            await interaction.response.send_message(
                f"No archived stats for '{player_name}' in season '{season_name}'.",
                ephemeral=True,
            )
            return
        (elo, rank, matches_played, matches_won, tk, td, ta, kd, mvps, score,
         avg_hs, play_time, peak_elo) = row
        win_rate = (matches_won / matches_played * 100) if matches_played else 0
        embed = discord.Embed(
            title=f"{season_name} — {player_name}", color=discord.Color.gold()
        )
        embed.add_field(name="Final Elo", value=str(elo), inline=True)
        embed.add_field(name="Final Rank", value=str(rank), inline=True)
        embed.add_field(name="Peak Elo", value=str(peak_elo), inline=True)
        embed.add_field(name="Matches Played", value=str(matches_played), inline=True)
        embed.add_field(name="Matches Won", value=str(matches_won), inline=True)
        embed.add_field(name="Win Rate", value=f"{win_rate:.2f}%", inline=True)
        embed.add_field(name="K / D / A", value=f"{tk} / {td} / {ta}", inline=True)
        embed.add_field(name="K/D Ratio", value=str(kd), inline=True)
        embed.add_field(name="MVPs", value=str(mvps), inline=True)
        embed.add_field(name="Total Score", value=str(score), inline=True)
        embed.add_field(name="Avg HS%", value=f"{avg_hs:.1f}%", inline=True)
        await interaction.response.send_message(embed=embed)

    @season_stats.autocomplete("season_name")
    async def _season_stats_season_ac(self, interaction: discord.Interaction, current: str):
        rows = await db.fetchall(
            "SELECT DISTINCT season_name FROM season_stats ORDER BY season_name"
        )
        cur = (current or "").lower()
        return [
            app_commands.Choice(name=r[0], value=r[0])
            for r in rows if r[0] and cur in r[0].lower()
        ][:25]

    @season_stats.autocomplete("player_name")
    async def _season_stats_player_ac(self, interaction: discord.Interaction, current: str):
        return await _player_choices(current)


async def setup(bot: commands.Bot):
    await bot.add_cog(PlayersCog(bot))
