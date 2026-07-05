"""Match-flow commands: /mapvote, /teamselection, /vote_tie, /resetdb, plus the
map-veto / side-pick / captain-draft / tie-vote Views.

Map pool and side names come from the active game profile (GAME), so the veto
works for any game.
"""

import logging
import time

import discord
from discord import app_commands
from discord.ext import commands
from discord.ui import View, Button

from config.settings import MM_MANAGER_ROLE
from core import db
from core.cosmetics import award_season_placements, sync_top10_badge
from core.game_profile import ACTIVE as GAME
from cogs.shared import has_required_role
from cogs.queue_state import queue_players, queue_channels

logger = logging.getLogger(__name__)


class SideSelectionView(View):
    def __init__(self, captain_id, captain_name, team_number):
        super().__init__(timeout=None)
        self.captain_id = captain_id
        self.captain_name = captain_name
        self.team_number = team_number
        for side in GAME.sides:
            btn = Button(label=f"{side} Side", style=discord.ButtonStyle.primary)
            btn.callback = lambda interaction, s=side: self._choose(interaction, s)
            self.add_item(btn)

    async def _choose(self, interaction: discord.Interaction, side: str):
        if interaction.user.id != self.captain_id:
            await interaction.response.send_message(
                "Only the captain can select the side!", ephemeral=True
            )
            return
        await interaction.response.edit_message(
            content=f"{self.captain_name}'s team (Team {self.team_number}) will start on {side} side!",
            view=None,
        )


class MapVoteView(View):
    def __init__(self, captain1_id, captain2_id, team1_captain_id, team2_captain_id):
        super().__init__(timeout=None)
        self.captain1_id = captain1_id
        self.captain2_id = captain2_id
        self.team1_captain_id = team1_captain_id
        self.team2_captain_id = team2_captain_id
        self.current_captain_id = captain1_id
        self.maps = list(GAME.maps)
        self.update_buttons()

    def update_buttons(self):
        self.clear_items()
        for map_name in self.maps:
            button = Button(label=map_name, style=discord.ButtonStyle.primary)
            button.callback = lambda i, m=map_name: self.handle_vote(i, m)
            self.add_item(button)

    async def handle_vote(self, interaction: discord.Interaction, map_name: str):
        if interaction.user.id != self.current_captain_id:
            await interaction.response.send_message("It's not your turn to vote!", ephemeral=True)
            return
        if map_name not in self.maps:
            return
        self.maps.remove(map_name)

        if len(self.maps) == 1:
            chosen_map = self.maps[0]
            await interaction.response.edit_message(
                content=f"**Map chosen: {chosen_map}**", view=None
            )
            # Side selection only if this game has sides.
            if GAME.sides:
                captain1_member = interaction.guild.get_member(self.captain1_id)
                team_number = "1" if self.captain1_id == self.team1_captain_id else "2"
                side_view = SideSelectionView(
                    self.captain1_id, captain1_member.display_name, team_number
                )
                await interaction.followup.send(
                    f"<@{self.captain1_id}>, please choose your starting side for {chosen_map}:",
                    view=side_view,
                )
        else:
            self.current_captain_id = (
                self.captain2_id if self.current_captain_id == self.captain1_id else self.captain1_id
            )
            self.update_buttons()
            await interaction.response.edit_message(
                content=(
                    f"**{map_name}** has been banned!\nRemaining maps: {', '.join(self.maps)}\n"
                    f"<@{self.current_captain_id}>'s turn to ban."
                ),
                view=self,
            )


class TeamSelectionView(View):
    def __init__(self, captain1, captain2, members):
        super().__init__(timeout=None)
        self.captain1 = captain1
        self.captain2 = captain2
        self.current_captain = captain1
        self.members = [m for m in members if m.id not in (captain1, captain2)]
        self.team1 = []
        self.team2 = []
        self.selected_members = set()

        self.member_groups = {}
        for member in self.members:
            if member.voice and member.voice.channel:
                self.member_groups.setdefault(member.voice.channel.id, []).append(member)

        for member in self.members:
            button = Button(label=member.name, style=discord.ButtonStyle.primary)
            button.callback = lambda interaction, m=member: self.handle_pick(interaction, m)
            self.add_item(button)

    def update_buttons(self):
        for child in self.children:
            if isinstance(child, Button):
                child.disabled = child.label in [
                    m.name for m in self.members if m.name in self.selected_members
                ]

    async def interaction_check(self, interaction):
        return interaction.user.id in (self.captain1, self.captain2)

    async def handle_pick(self, interaction, member):
        if interaction.user.id != self.current_captain:
            await interaction.response.send_message("It's not your turn to pick!", ephemeral=True)
            return
        if member.name in self.selected_members:
            await interaction.response.send_message(
                f"{member.name} has already been selected!", ephemeral=True
            )
            return

        party_members = []
        if member.voice and member.voice.channel:
            party_members = self.member_groups.get(member.voice.channel.id, [])
        party_members = [
            m for m in party_members
            if m.name not in self.selected_members and m.id not in (self.captain1, self.captain2)
        ]

        total_players = len([m for m in self.members if m.id not in (self.captain1, self.captain2)])
        players_per_team = total_players // 2
        target_team = self.team1 if self.current_captain == self.captain1 else self.team2
        for party_member in party_members[: players_per_team - len(target_team)]:
            target_team.append(party_member.name)
            self.selected_members.add(party_member.name)

        self.current_captain = (
            self.captain2 if self.current_captain == self.captain1 else self.captain1
        )

        if len(self.team1) == players_per_team and len(self.team2) == players_per_team:
            await interaction.response.edit_message(
                content=(
                    f"Teams Selected!\n\n"
                    f"Team 1\nCaptain: {interaction.guild.get_member(self.captain1).mention}\n"
                    f"Players: {', '.join(self.team1)}\n\n"
                    f"Team 2\nCaptain: {interaction.guild.get_member(self.captain2).mention}\n"
                    f"Players: {', '.join(self.team2)}"
                ),
                view=None,
            )
        else:
            self.update_buttons()
            remaining = [
                m.name for m in self.members
                if m.name not in self.selected_members and m.id not in (self.captain1, self.captain2)
            ]
            await interaction.response.edit_message(
                content=(
                    f"{member.name}'s party has been selected!\n"
                    f"Remaining members: {', '.join(remaining)}\n\n"
                    f"Team 1: {', '.join(self.team1)}\nTeam 2: {', '.join(self.team2)}\n\n"
                    f"Current turn: {interaction.guild.get_member(self.current_captain).mention}"
                ),
                view=self,
            )


class VoteTieView(View):
    def __init__(self, eligible_members, required_votes, ms_user_id, timeout=120):
        super().__init__(timeout=timeout)
        self.eligible_ids = {m.id for m in eligible_members}
        self.eligible_members = eligible_members
        self.required_votes = required_votes
        self.ms_user_id = ms_user_id
        self.yes_votes = set()
        self.responded = set()
        self.result_sent = False
        self.message = None

    def current_status_embed(self):
        return discord.Embed(
            title="Overtime Tie Vote",
            description=(
                f"Required tie votes: **{self.required_votes}**\n"
                f"Yes votes: **{len(self.yes_votes)}** / {len(self.eligible_ids)}\n"
                f"Eligible voters (capped at 10): "
                f"{', '.join(m.display_name for m in self.eligible_members)}"
            ),
            color=discord.Color.orange(),
        )

    @discord.ui.button(label="Vote Tie", style=discord.ButtonStyle.green)
    async def vote_tie(self, interaction: discord.Interaction, button: Button):
        if interaction.user.id not in self.eligible_ids:
            await interaction.response.send_message(
                "You are not eligible to vote in this match.", ephemeral=True
            )
            return
        if interaction.user.id in self.responded:
            await interaction.response.send_message("You have already voted.", ephemeral=True)
            return
        self.responded.add(interaction.user.id)
        self.yes_votes.add(interaction.user.id)
        await interaction.response.send_message(
            "Your vote for a tie has been recorded.", ephemeral=True
        )
        try:
            await interaction.message.edit(embed=self.current_status_embed(), view=self)
        except Exception:
            pass
        if len(self.yes_votes) >= self.required_votes and not self.result_sent:
            await self.finalize_vote(interaction.message.channel)

    @discord.ui.button(label="Finalize Vote (Match Staff)", style=discord.ButtonStyle.primary)
    async def finalize(self, interaction: discord.Interaction, button: Button):
        if not has_required_role(interaction) and interaction.user.id != self.ms_user_id:
            await interaction.response.send_message(
                "You don't have permission to finalize this vote.", ephemeral=True
            )
            return
        await interaction.response.send_message("Finalizing tie vote...", ephemeral=True)
        await self.finalize_vote(interaction.channel)

    async def on_timeout(self):
        if not self.result_sent and self.message:
            try:
                await self.finalize_vote(self.message.channel)
            except Exception:
                logger.exception("Error finalizing tie vote on timeout")

    async def finalize_vote(self, channel):
        if self.result_sent:
            return
        self.result_sent = True
        passed = len(self.yes_votes) >= self.required_votes
        embed = discord.Embed(
            title="Tie Vote Result",
            description=(
                f"Yes votes: **{len(self.yes_votes)}** / {len(self.eligible_ids)}\n"
                f"Required: **{self.required_votes}**\n"
                f"Result: **{'TIE' if passed else 'NO TIE'}**"
            ),
            color=discord.Color.green() if passed else discord.Color.red(),
        )
        for child in list(self.children):
            try:
                child.disabled = True
            except Exception:
                pass
        try:
            if self.message:
                try:
                    await self.message.edit(embed=embed, view=self)
                except Exception:
                    await channel.send(embed=embed)
            else:
                await channel.send(embed=embed)
        except Exception:
            logger.exception("Failed to announce tie vote result")


class MatchflowCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="mapvote", description="Start a map voting session between two users. Captain 1 starts."
    )
    async def mapvote(
        self, interaction: discord.Interaction, captain1: discord.Member, captain2: discord.Member
    ):
        if interaction.user not in (captain1, captain2):
            await interaction.response.send_message(
                "You cannot vote for maps since you are not one of the captains!", ephemeral=True
            )
            return
        view = MapVoteView(captain1.id, captain2.id, captain1.id, captain2.id)
        await interaction.response.send_message(
            content=f"Map banning has started! Remaining maps: {', '.join(GAME.maps)}.", view=view
        )

    @app_commands.command(
        name="teamselection", description="Start a team selection session between two captains."
    )
    async def teamselection(
        self, interaction: discord.Interaction, captain1: discord.Member, captain2: discord.Member
    ):
        valid_channels = [
            "Solo queue", "Duo queue [1]", "Duo queue [2]", "Duo queue [3]",
            "Trio queue [1]", "Trio queue [2]", "Trio queue [3]",
        ]
        members = []
        for channel in interaction.guild.voice_channels:
            if channel.name in valid_channels:
                members.extend(
                    m for m in channel.members if m.id not in (captain1.id, captain2.id)
                )
        if len(members) < 10:
            await interaction.response.send_message(
                "There must be at least 10 users in the voice channel to form two teams.",
                ephemeral=True,
            )
            return
        view = TeamSelectionView(captain1.id, captain2.id, members)
        await interaction.response.send_message(
            content=(
                f"Team selection has started! Remaining members: "
                f"{', '.join(m.name for m in members)}\n\n"
                "Captains will take turns picking players. Members in the same queue channels "
                "will be picked together."
            ),
            view=view,
        )

    @app_commands.command(
        name="resetdb", description="Season reset: award Top 10 badges then reset player stats."
    )
    async def reset_database(
        self, interaction: discord.Interaction, season_name: str, badge_emoji: str
    ):
        if discord.utils.get(interaction.user.roles, name=MM_MANAGER_ROLE) is None:
            await interaction.response.send_message(
                embed=discord.Embed(
                    title="Permission Denied",
                    description=f"You do not have the required role ('{MM_MANAGER_ROLE}').",
                    color=discord.Color.red(),
                ),
                ephemeral=True,
            )
            return
        season_name, badge_emoji = season_name.strip(), badge_emoji.strip()
        if not season_name or not badge_emoji:
            await interaction.response.send_message(
                "Season name and badge emoji cannot be empty.", ephemeral=True
            )
            return
        try:
            top10_names = [
                r[0] for r in await db.fetchall(
                    """SELECT name FROM players
                       ORDER BY elo DESC, matches_won DESC, matches_played ASC LIMIT 10"""
                ) if r and r[0]
            ]
            awarded = []
            for player_name in top10_names:
                badge_text = f"{season_name} {badge_emoji} SFHL C | {player_name}"
                if await db.fetchone(
                    "SELECT 1 FROM badges WHERE player_name = ? AND badge_name = ?",
                    (player_name, badge_text),
                ):
                    continue
                try:
                    await db.execute(
                        "INSERT INTO badges (player_name, badge_name) VALUES (?, ?)",
                        (player_name, badge_text),
                    )
                    awarded.append(player_name)
                except Exception as ie:
                    logger.error(f"Failed inserting badge for {player_name}: {ie}")

            # Grant the website's seasonal placement badges (Champion / Top 3 /
            # Top 10 cosmetic items) while the standings are still live.
            try:
                placed = await award_season_placements(season_name)
            except Exception:
                logger.exception("Failed awarding season placement items")
                placed = []

            # Archive every player's aggregate stats under this season name before
            # the columns are zeroed, so past seasons stay queryable (/seasonstats)
            # and the new season starts clean. Idempotent per (season, player) via
            # season_stats' unique index. Permanent rewards (badges/cosmetics/coins/
            # identity/friends) live on their own tables and are untouched.
            archived_count = 0
            try:
                stat_rows = await db.fetchall(
                    """SELECT name, elo, rank, matches_played, matches_won, total_kills,
                              total_deaths, total_assists, kd_ratio, total_mvps, total_score,
                              total_headshot_percentage, avg_hs_percent, total_play_time, peak_elo
                       FROM players"""
                )
                if stat_rows:
                    now_ms = int(time.time() * 1000)
                    await db.batch([
                        (
                            """INSERT OR REPLACE INTO season_stats
                               (season_name, player_name, elo, rank, matches_played, matches_won,
                                total_kills, total_deaths, total_assists, kd_ratio, total_mvps,
                                total_score, total_headshot_percentage, avg_hs_percent,
                                total_play_time, peak_elo, archived_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (season_name, *tuple(r), now_ms),
                        )
                        for r in stat_rows
                    ])
                    archived_count = len(stat_rows)
            except Exception:
                logger.exception("Failed to archive season stats on /resetdb")

            # Zero the live season columns: standings (elo/rank/placement) AND the
            # aggregate stat totals now safely archived above.
            await db.execute(
                """UPDATE players SET elo = 0, rank = '[?] Unranked', placement_points = 0,
                   placement_games_played = 0, placement_done = 0,
                   matches_played = 0, matches_won = 0, total_kills = 0, total_deaths = 0,
                   total_assists = 0, kd_ratio = 0.0, total_mvps = 0, total_score = 0,
                   total_headshot_percentage = 0.0, avg_hs_percent = 0.0, total_play_time = 0,
                   peak_elo = 0"""
            )

            # Drop any stale post-queue lobbies from last season.
            try:
                await db.execute("DELETE FROM web_lobbies")
            except Exception:
                logger.exception("Failed to clear web_lobbies on /resetdb")

            # Everyone is at 0 Elo now — revoke the dynamic Top 10 badge from
            # last season's holders right away instead of waiting for the task.
            try:
                await sync_top10_badge()
            except Exception:
                logger.exception("Failed syncing the Top 10 badge after reset")

            embed = discord.Embed(
                title="Season Reset Completed",
                description=(
                    f"Season: {season_name}\n"
                    f"Top 10 captured: {', '.join(top10_names) if top10_names else 'None'}"
                ),
                color=discord.Color.green(),
            )
            embed.add_field(
                name="Badges Awarded",
                value="\n".join(awarded) if awarded else "No new badges (already existed).",
                inline=False,
            )
            embed.add_field(
                name="Placement Items Awarded",
                value="\n".join(placed) if placed else "None",
                inline=False,
            )
            embed.add_field(
                name="Stats Archived",
                value=(
                    f"{archived_count} players' stats saved to season \"{season_name}\" "
                    "(view with /seasonstats)."
                ),
                inline=False,
            )
            await interaction.response.send_message(embed=embed)
            logger.info(f"Season reset complete for '{season_name}'. Awarded: {awarded}")
        except Exception as e:
            logger.error(f"Failed during season reset: {e}")
            await interaction.response.send_message(
                "An error occurred while performing the season reset.", ephemeral=True
            )

    @app_commands.command(
        name="vote_tie", description="Start a tie vote for an overtime. Match Staff only."
    )
    async def vote_tie_command(self, interaction: discord.Interaction, overtime_count: int):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        if overtime_count <= 0:
            await interaction.response.send_message(
                "Overtime count must be >= 1.", ephemeral=True
            )
            return
        required = {1: 6, 2: 5, 3: 3}.get(overtime_count, 1)

        channel = interaction.channel
        eligible = queue_players.get(channel.id)
        if not eligible:
            for _idx, ch in queue_channels.items():
                if ch and getattr(ch, "id", None) == getattr(channel, "id", None):
                    eligible = queue_players.get(getattr(ch, "id", None))
                    break
        if not eligible:
            await interaction.response.send_message(
                "This command must be run in the queue game channel (where players were added). "
                "No eligible voters found.",
                ephemeral=True,
            )
            return

        eligible = [m for m in eligible if not getattr(m, "bot", False)][:10]
        if required > len(eligible):
            await interaction.response.send_message(
                f"Warning: required votes ({required}) exceed eligible voters ({len(eligible)}). "
                "Vote may not pass.",
                ephemeral=True,
            )

        view = VoteTieView(eligible, required, interaction.user.id, timeout=120)
        await interaction.response.send_message(embed=view.current_status_embed(), view=view)
        try:
            view.message = await interaction.original_response()
        except Exception:
            pass


async def setup(bot: commands.Bot):
    await bot.add_cog(MatchflowCog(bot))
