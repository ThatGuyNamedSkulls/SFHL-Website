"""Moderation commands: user reports (and, incrementally, timeouts/warnings).

Migrated out of main.py as the first cog. Uses the ``core.db.connect`` context
manager (one connection per operation) instead of the old shared global cursor.
"""

import logging
from datetime import datetime, timedelta

import discord
from discord import app_commands
from discord.ext import commands

from core import db
from core.moderation_data import (
    cleanup_old_leaving_incidents,
    get_or_create_warning_count,
    get_leaving_incident_count,
    calculate_leaving_elo_penalty,
    leaving_window_cutoff,
)
from core.players import get_player_elo, update_player_elo
from cogs.shared import has_required_role

logger = logging.getLogger(__name__)

# Timeout reasons -> duration in minutes.
TIMEOUT_REASONS = {
    "Team killing": 60,  # 1 hour per kill
    "Queue AFK": 60,  # 1 hour timeout
    "Leaving mid game": 180,  # 3 hour timeout
    "Trolling": 360,  # 6 hour timeout
    "Ghosting": 10080,  # 7 days
    "Trying to ghost": 4320,  # 3 days
    "Unauthorized kicking": 360,  # 6 hours
    "Throwing (Very sure on purpose)": 4320,  # 3 days
    "Leaking VIP server link": 720,  # 12 hours
}


async def process_leaving_mid_game(user_id: int, user_name: str) -> tuple[int, int]:
    """Record a leaving incident and apply the escalating ELO penalty.

    Returns (incident_count, elo_penalty).
    """
    current_count = await get_leaving_incident_count(user_id)
    new_count = current_count + 1
    elo_penalty = calculate_leaving_elo_penalty(new_count)

    await db.execute(
        "INSERT INTO leaving_incidents (user_id, user_name, elo_penalty, incident_count) "
        "VALUES (?, ?, ?, ?)",
        (user_id, user_name, elo_penalty, new_count),
    )

    try:
        current_elo = await get_player_elo(user_name)
        if current_elo is not None:
            new_elo = max(0, current_elo - elo_penalty)
            await update_player_elo(user_name, new_elo)
            logger.info(f"Applied {elo_penalty} ELO penalty to {user_name}. New ELO: {new_elo}")
        else:
            logger.warning(f"Could not find player {user_name} in database for ELO penalty")
    except Exception as e:
        logger.error(f"Error applying ELO penalty to {user_name}: {e}")

    return new_count, elo_penalty


class TeamKillCountView(discord.ui.View):
    def __init__(self, user: discord.Member, moderator: discord.Interaction):
        super().__init__(timeout=60)
        self.user = user
        self.moderator = moderator
        self.selected_count = 1

    @discord.ui.button(label="Enter Team Kill Count", style=discord.ButtonStyle.primary, emoji="🔢")
    async def enter_count(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(TeamKillCountModal(self.user, self.moderator))

    async def on_timeout(self):
        try:
            await self.moderator.edit_original_response(
                content="⏰ Team kill count selection timed out. Please use the `/timeout` command again.",
                view=None,
            )
        except Exception:
            pass


class TeamKillCountModal(discord.ui.Modal):
    def __init__(self, user: discord.Member, moderator: discord.Interaction):
        super().__init__(title="Team Kill Count")
        self.user = user
        self.moderator = moderator

    team_kill_count = discord.ui.TextInput(
        label="How many team kills?",
        placeholder="Enter a number (e.g., 1, 5, 15, 50...)",
        min_length=1,
        max_length=3,
        required=True,
    )

    async def on_submit(self, interaction: discord.Interaction):
        try:
            count = int(self.team_kill_count.value)
            if count <= 0:
                await interaction.response.send_message(
                    "Team kill count must be a positive number!", ephemeral=True
                )
                return
            if count > 168:
                await interaction.response.send_message(
                    "Team kill count is too high! Maximum is 168 (1 week timeout).", ephemeral=True
                )
                return
            await self._process(interaction, count)
        except ValueError:
            await interaction.response.send_message("Please enter a valid number!", ephemeral=True)

    async def _process(self, interaction: discord.Interaction, count: int):
        try:
            duration_minutes = 60 * count
            duration_timedelta = timedelta(minutes=duration_minutes)
            expiry_time = datetime.now() + duration_timedelta
            detailed_reason = (
                "Team killing (1 team kill)" if count == 1 else f"Team killing ({count} team kills)"
            )

            warning_count = await get_or_create_warning_count(self.user.id, self.user.display_name)

            await db.execute(
                """INSERT INTO timeouts (user_id, user_name, reason, duration_minutes,
                   moderator_id, moderator_name, expiry_time)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (self.user.id, self.user.display_name, detailed_reason, duration_minutes,
                 self.moderator.user.id, self.moderator.user.display_name, expiry_time),
            )

            await self.user.timeout(
                duration_timedelta, reason=f"{detailed_reason} - Warning #{warning_count}"
            )

            duration_display = _format_duration(duration_minutes)

            embed = discord.Embed(
                title="🚨 User Timeout", color=discord.Color.red(), timestamp=datetime.now()
            )
            embed.add_field(
                name="User", value=f"{self.user.mention} ({self.user.display_name})", inline=False
            )
            embed.add_field(name="Reason", value=detailed_reason, inline=True)
            embed.add_field(name="Duration", value=duration_display, inline=True)
            embed.add_field(name="Warning Count", value=f"#{warning_count}", inline=True)
            embed.add_field(name="Moderator", value=self.moderator.user.mention, inline=False)
            embed.add_field(
                name="Expires", value=f"<t:{int(expiry_time.timestamp())}:R>", inline=False
            )
            embed.set_footer(text="Timeout issued by Match Staff")

            await self.moderator.edit_original_response(content=None, embed=embed, view=None)

            try:
                dm_embed = discord.Embed(
                    title="⚠️ You have been timed out",
                    color=discord.Color.orange(),
                    timestamp=datetime.now(),
                )
                dm_embed.add_field(name="Server", value=self.moderator.guild.name, inline=False)
                dm_embed.add_field(name="Reason", value=detailed_reason, inline=True)
                dm_embed.add_field(name="Duration", value=duration_display, inline=True)
                dm_embed.add_field(
                    name="Warning Count", value=f"This is your warning #{warning_count}", inline=False
                )
                dm_embed.add_field(
                    name="Expires", value=f"<t:{int(expiry_time.timestamp())}:F>", inline=False
                )
                dm_embed.set_footer(text="Please follow server rules to avoid future timeouts")
                await self.user.send(embed=dm_embed)
            except discord.Forbidden:
                await interaction.followup.send(
                    f"⚠️ Could not send DM to {self.user.mention} - their DMs may be disabled.",
                    ephemeral=True,
                )

            await interaction.response.send_message("✅ Timeout applied successfully!", ephemeral=True)
            logger.info(
                f"User {self.user.display_name} ({self.user.id}) timed out by "
                f"{self.moderator.user.display_name} for {detailed_reason} - Warning #{warning_count}"
            )
        except discord.Forbidden:
            await interaction.response.send_message(
                f"I don't have permission to timeout {self.user.mention}.", ephemeral=True
            )
        except Exception as e:
            logger.error(f"Error in team kill timeout processing: {e}")
            await interaction.response.send_message(
                "An error occurred while processing the timeout.", ephemeral=True
            )


def _format_duration(duration_minutes: int) -> str:
    """Human-readable timeout duration."""
    if duration_minutes >= 1440:
        days = duration_minutes // 1440
        hours = (duration_minutes % 1440) // 60
        return f"{days} day(s) and {hours} hour(s)" if hours else f"{days} day(s)"
    if duration_minutes >= 60:
        return f"{duration_minutes // 60} hour(s)"
    return f"{duration_minutes} minute(s)"


class ModerationCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="report", description="Report a user for misconduct.")
    async def report_user(
        self, interaction: discord.Interaction, reported_user: str, reason: str
    ):
        """Allow users to report others."""
        try:
            await db.execute(
                "INSERT INTO reports (reporter_name, reported_user, reason) VALUES (?, ?, ?)",
                (interaction.user.name, reported_user, reason),
            )
            logger.info(f"User '{interaction.user.name}' reported '{reported_user}' for: {reason}")

            embed = discord.Embed(
                title="Report Submitted",
                description=(
                    "Thank you for your report. Our team will review it shortly.\n\n"
                    f"**Reported User**: {reported_user}\n**Reason**: {reason}"
                ),
                color=discord.Color.green(),
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Failed to submit report: {e}")
            await interaction.response.send_message(
                "An error occurred while submitting your report. Please try again later.",
                ephemeral=True,
            )

    @report_user.autocomplete("reported_user")
    async def reported_user_autocomplete(
        self, interaction: discord.Interaction, current: str
    ):
        """Autocomplete player names based on partial input."""
        results = await db.fetchall(
            "SELECT name FROM players WHERE name LIKE ?", (f"%{current}%",)
        )
        return [app_commands.Choice(name=row[0], value=row[0]) for row in results[:5]]

    @app_commands.command(name="viewreports", description="View all user reports (staff only).")
    async def view_reports(self, interaction: discord.Interaction):
        """Allow staff to view all reports."""
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        try:
            reports = await db.fetchall(
                "SELECT reporter_name, reported_user, reason, timestamp FROM reports"
            )

            if reports:
                embed = discord.Embed(title="User Reports", color=discord.Color.blue())
                for reporter, reported, reason, timestamp in reports:
                    embed.add_field(
                        name=f"Reported User: {reported}",
                        value=f"Reported By: {reporter}\nReason: {reason}\nTime: {timestamp}",
                        inline=False,
                    )
                await interaction.response.send_message(embed=embed, ephemeral=True)
            else:
                await interaction.response.send_message("No reports found.", ephemeral=True)
        except Exception as e:
            logger.error(f"Failed to retrieve reports: {e}")
            await interaction.response.send_message(
                "An error occurred while retrieving reports. Please try again later.",
                ephemeral=True,
            )


    @app_commands.command(
        name="timeouthistory", description="View timeout history and warnings for a user."
    )
    async def timeout_history(self, interaction: discord.Interaction, user: discord.Member):
        """View timeout history and warning count for a specific user."""
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        try:
            warning_result = await db.fetchone(
                "SELECT warning_count FROM warnings WHERE user_id = ?", (user.id,)
            )
            warning_count = warning_result[0] if warning_result else 0

            timeouts = await db.fetchall(
                """SELECT reason, duration_minutes, moderator_name, timestamp, expiry_time
                   FROM timeouts WHERE user_id = ?
                   ORDER BY timestamp DESC LIMIT 10""",
                (user.id,),
            )

            embed = discord.Embed(
                title=f"Timeout History: {user.display_name}",
                color=discord.Color.blue(),
                timestamp=datetime.now(),
            )
            embed.add_field(name="Total Warnings", value=str(warning_count), inline=True)
            embed.add_field(name="Total Timeouts", value=str(len(timeouts)), inline=True)
            embed.add_field(name="User ID", value=str(user.id), inline=True)

            if timeouts:
                history_text = ""
                for i, (reason, duration, moderator, timestamp_str, _expiry) in enumerate(
                    timeouts[:5], 1
                ):
                    try:
                        timestamp_dt = datetime.fromisoformat(timestamp_str)
                        time_display = f"<t:{int(timestamp_dt.timestamp())}:d>"
                    except (ValueError, TypeError):
                        time_display = timestamp_str

                    if duration >= 1440:
                        duration_display = f"{duration // 1440}d"
                    elif duration >= 60:
                        duration_display = f"{duration // 60}h"
                    else:
                        duration_display = f"{duration}m"

                    history_text += (
                        f"**{i}.** {reason} ({duration_display}) - {moderator}\n{time_display}\n\n"
                    )
                embed.add_field(
                    name="Recent Timeouts",
                    value=history_text or "No recent timeouts",
                    inline=False,
                )
            else:
                embed.add_field(
                    name="Recent Timeouts", value="No timeout history found", inline=False
                )

            embed.set_footer(text="Timeout history requested by Match Staff")
            await interaction.response.send_message(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Error in timeout history command: {e}")
            await interaction.response.send_message(
                "An error occurred while retrieving timeout history.", ephemeral=True
            )

    @app_commands.command(
        name="leavinghistory",
        description="View leaving mid game history and ELO penalties for a user.",
    )
    async def leaving_history(self, interaction: discord.Interaction, user: discord.Member):
        """View leaving mid game history and penalties for a specific user."""
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        try:
            await cleanup_old_leaving_incidents(user.id)

            recent_incidents = await db.fetchall(
                """SELECT elo_penalty, incident_count, timestamp
                   FROM leaving_incidents WHERE user_id = ? AND timestamp >= ?
                   ORDER BY timestamp DESC LIMIT 10""",
                (user.id, leaving_window_cutoff()),
            )

            # Bugfix: the original called fetchone() twice here, which raised.
            total_row = await db.fetchone(
                "SELECT COUNT(*) FROM leaving_incidents WHERE user_id = ?", (user.id,)
            )
            total_incidents = total_row[0] if total_row else 0

            total_elo_lost = sum(incident[0] for incident in recent_incidents)

            embed = discord.Embed(
                title=f"Leaving Mid Game History: {user.display_name}",
                color=discord.Color.orange(),
                timestamp=datetime.now(),
            )
            embed.add_field(
                name="Recent Incidents (3 days)", value=str(len(recent_incidents)), inline=True
            )
            embed.add_field(name="Total ELO Lost (3 days)", value=f"-{total_elo_lost}", inline=True)
            embed.add_field(name="All-time Incidents", value=str(total_incidents), inline=True)

            if recent_incidents:
                history_text = ""
                for i, (elo_penalty, incident_count, timestamp_str) in enumerate(
                    recent_incidents[:5], 1
                ):
                    try:
                        timestamp_dt = datetime.fromisoformat(timestamp_str)
                        time_display = f"<t:{int(timestamp_dt.timestamp())}:d>"
                    except (ValueError, TypeError):
                        time_display = timestamp_str
                    history_text += (
                        f"**{i}.** Incident #{incident_count} - {elo_penalty} ELO penalty\n"
                        f"{time_display}\n\n"
                    )
                embed.add_field(
                    name="Recent Incidents Details",
                    value=history_text or "No recent incidents",
                    inline=False,
                )
            else:
                embed.add_field(
                    name="Recent Incidents Details",
                    value="No incidents in the last 3 days",
                    inline=False,
                )

            penalty_info = (
                "**ELO Penalty Scale (resets after 3 days):**\n"
                "1st: -15 ELO • 2nd: -18 ELO • 3rd: -22 ELO\n"
                "4th: -25 ELO • 5th: -30 ELO • 6th: -30 ELO\n"
                "7th: -35 ELO • 8th+: -40 ELO"
            )
            embed.add_field(name="Penalty System", value=penalty_info, inline=False)
            embed.set_footer(
                text="Leaving history requested by Match Staff • Incidents auto-expire after 3 days"
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Error in leaving history command: {e}")
            await interaction.response.send_message(
                "An error occurred while retrieving leaving history.", ephemeral=True
            )


    @app_commands.command(
        name="timeout",
        description="Timeout a user for a specified reason with automatic warning tracking.",
    )
    async def timeout_user(
        self, interaction: discord.Interaction, user: discord.Member, reason: str
    ):
        """Timeout a user with predefined reasons and durations."""
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return

        if reason not in TIMEOUT_REASONS:
            valid_reasons = "\n".join([f"• {r}" for r in TIMEOUT_REASONS.keys()])
            await interaction.response.send_message(
                f"Invalid reason. Valid reasons are:\n{valid_reasons}", ephemeral=True
            )
            return

        # Team killing -> ask for a count via modal.
        if reason == "Team killing":
            embed = discord.Embed(
                title="🔫 Team Killing Timeout",
                description=(
                    f"Click the button below to enter how many team kills {user.mention} "
                    f"committed.\n**Formula:** 1 team kill = 1 hour timeout"
                ),
                color=discord.Color.orange(),
            )
            embed.add_field(
                name="User", value=f"{user.mention} ({user.display_name})", inline=False
            )
            embed.add_field(name="Moderator", value=interaction.user.mention, inline=False)
            embed.add_field(
                name="Examples",
                value="• 1 team kill = 1 hour\n• 15 team kills = 15 hours\n• 50 team kills = 50 hours",
                inline=False,
            )
            await interaction.response.send_message(
                embed=embed, view=TeamKillCountView(user, interaction), ephemeral=True
            )
            return

        # Leaving mid game -> apply escalating ELO penalty.
        if reason == "Leaving mid game":
            incident_count, elo_penalty = await process_leaving_mid_game(user.id, user.display_name)
            duration_minutes = TIMEOUT_REASONS[reason]
            duration_timedelta = timedelta(minutes=duration_minutes)
            expiry_time = datetime.now() + duration_timedelta
            warning_count = await get_or_create_warning_count(user.id, user.display_name)
            detailed_reason = f"Leaving mid game (#{incident_count} in 3 days, -{elo_penalty} ELO)"

            await db.execute(
                """INSERT INTO timeouts (user_id, user_name, reason, duration_minutes,
                   moderator_id, moderator_name, expiry_time)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user.id, user.display_name, detailed_reason, duration_minutes,
                 interaction.user.id, interaction.user.display_name, expiry_time),
            )

            await user.timeout(
                duration_timedelta, reason=f"{detailed_reason} - Warning #{warning_count}"
            )
            duration_display = _format_duration(duration_minutes)

            embed = discord.Embed(
                title="🚨 User Timeout - Leaving Mid Game",
                color=discord.Color.red(),
                timestamp=datetime.now(),
            )
            embed.add_field(name="User", value=f"{user.mention} ({user.display_name})", inline=False)
            embed.add_field(name="Reason", value="Leaving mid game", inline=True)
            embed.add_field(name="Duration", value=duration_display, inline=True)
            embed.add_field(name="Warning Count", value=f"#{warning_count}", inline=True)
            embed.add_field(name="ELO Penalty", value=f"-{elo_penalty} ELO", inline=True)
            embed.add_field(name="Incidents (3 days)", value=f"#{incident_count}", inline=True)
            embed.add_field(name="Moderator", value=interaction.user.mention, inline=False)
            embed.add_field(
                name="Expires", value=f"<t:{int(expiry_time.timestamp())}:R>", inline=False
            )
            embed.set_footer(text="ELO penalty applied • Incidents reset after 3 days")
            await interaction.response.send_message(embed=embed)

            try:
                dm_embed = discord.Embed(
                    title="⚠️ You have been timed out",
                    color=discord.Color.orange(),
                    timestamp=datetime.now(),
                )
                dm_embed.add_field(name="Server", value=interaction.guild.name, inline=False)
                dm_embed.add_field(name="Reason", value="Leaving mid game", inline=True)
                dm_embed.add_field(name="Duration", value=duration_display, inline=True)
                dm_embed.add_field(name="ELO Penalty", value=f"-{elo_penalty} ELO", inline=True)
                dm_embed.add_field(
                    name="Incidents (3 days)", value=f"This is incident #{incident_count}", inline=True
                )
                dm_embed.add_field(
                    name="Warning Count", value=f"This is your warning #{warning_count}", inline=False
                )
                dm_embed.add_field(
                    name="Expires", value=f"<t:{int(expiry_time.timestamp())}:F>", inline=False
                )
                dm_embed.add_field(
                    name="⚠️ Important",
                    value="Repeated leaving incidents result in higher ELO penalties. Incidents reset after 3 days.",
                    inline=False,
                )
                dm_embed.set_footer(text="Please stay for the full match to avoid penalties")
                await user.send(embed=dm_embed)
            except discord.Forbidden:
                await interaction.followup.send(
                    f"⚠️ Could not send DM to {user.mention} - their DMs may be disabled.",
                    ephemeral=True,
                )

            logger.info(
                f"User {user.display_name} ({user.id}) timed out for leaving mid game - "
                f"Incident #{incident_count}, -{elo_penalty} ELO, Warning #{warning_count}"
            )
            return

        # All other reasons.
        try:
            duration_minutes = TIMEOUT_REASONS[reason]
            duration_timedelta = timedelta(minutes=duration_minutes)
            expiry_time = datetime.now() + duration_timedelta
            warning_count = await get_or_create_warning_count(user.id, user.display_name)

            await db.execute(
                """INSERT INTO timeouts (user_id, user_name, reason, duration_minutes,
                   moderator_id, moderator_name, expiry_time)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user.id, user.display_name, reason, duration_minutes,
                 interaction.user.id, interaction.user.display_name, expiry_time),
            )

            await user.timeout(duration_timedelta, reason=f"{reason} - Warning #{warning_count}")
            duration_display = _format_duration(duration_minutes)

            embed = discord.Embed(
                title="🚨 User Timeout", color=discord.Color.red(), timestamp=datetime.now()
            )
            embed.add_field(name="User", value=f"{user.mention} ({user.display_name})", inline=False)
            embed.add_field(name="Reason", value=reason, inline=True)
            embed.add_field(name="Duration", value=duration_display, inline=True)
            embed.add_field(name="Warning Count", value=f"#{warning_count}", inline=True)
            embed.add_field(name="Moderator", value=interaction.user.mention, inline=False)
            embed.add_field(
                name="Expires", value=f"<t:{int(expiry_time.timestamp())}:R>", inline=False
            )
            embed.set_footer(text="Timeout issued by Match Staff")
            await interaction.response.send_message(embed=embed)

            try:
                dm_embed = discord.Embed(
                    title="⚠️ You have been timed out",
                    color=discord.Color.orange(),
                    timestamp=datetime.now(),
                )
                dm_embed.add_field(name="Server", value=interaction.guild.name, inline=False)
                dm_embed.add_field(name="Reason", value=reason, inline=True)
                dm_embed.add_field(name="Duration", value=duration_display, inline=True)
                dm_embed.add_field(
                    name="Warning Count", value=f"This is your warning #{warning_count}", inline=False
                )
                dm_embed.add_field(
                    name="Expires", value=f"<t:{int(expiry_time.timestamp())}:F>", inline=False
                )
                dm_embed.set_footer(text="Please follow server rules to avoid future timeouts")
                await user.send(embed=dm_embed)
            except discord.Forbidden:
                await interaction.followup.send(
                    f"⚠️ Could not send DM to {user.mention} - their DMs may be disabled.",
                    ephemeral=True,
                )

            logger.info(
                f"User {user.display_name} ({user.id}) timed out for {reason} - "
                f"Warning #{warning_count}"
            )
        except discord.Forbidden:
            await interaction.response.send_message(
                f"I don't have permission to timeout {user.mention}.", ephemeral=True
            )
        except Exception as e:
            logger.error(f"Error in timeout command: {e}")
            await interaction.response.send_message(
                "An error occurred while processing the timeout.", ephemeral=True
            )

    @timeout_user.autocomplete("reason")
    async def reason_autocomplete(self, interaction: discord.Interaction, current: str):
        return [
            app_commands.Choice(name=reason, value=reason)
            for reason in TIMEOUT_REASONS.keys()
            if current.lower() in reason.lower()
        ][:25]


async def setup(bot: commands.Bot):
    await bot.add_cog(ModerationCog(bot))
