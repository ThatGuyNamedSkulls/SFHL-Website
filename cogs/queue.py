"""Queue & party system: /queue, /createparty, /invite, /leaveparty, /viewparty,
the QueueView (join/leave + game-channel creation + team balancing) and the
party-invite View.

Shared queue state lives in cogs.queue_state. The map-veto View comes from
cogs.matchflow.
"""

import itertools
import json
import logging
import random
import time

import discord
from discord import app_commands
from discord.ext import commands, tasks
from discord.ui import View, Button

from config.settings import MATCH_STAFF_ROLE, BLACKLIST_ROLE
from core import db
from core.game_profile import ACTIVE as GAME, QUEUE_MODES, set_team_size
from cogs.shared import has_required_role
from cogs.queue_state import (
    parties,
    queues,
    queue_channels,
    queue_players,
    web_party_members,
    get_current_queue,
)
from cogs.matchflow import MapVoteView

logger = logging.getLogger(__name__)


async def _save_queue_message_ref(channel_id: int, message_id: int) -> None:
    """Persist the live queue message location so a background task can recover
    and edit it after a bot restart."""
    await db.execute(
        "CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT)"
    )
    await db.execute(
        "INSERT OR REPLACE INTO bot_state (key, value) VALUES ('queue_message', ?)",
        (f"{channel_id}:{message_id}",),
    )


async def _persist_web_lobby(channel, guild, team1, team2) -> None:
    """Write a post-queue lobby row the website reads to show matched players
    their teams + a link to this Discord channel. Supersedes any older lobby
    that still lists one of these players (they can only be in one match)."""
    try:
        members = [
            {"discordId": str(p.id), "name": p.display_name, "team": team_no}
            for team_no, team in ((1, team1), (2, team2))
            for p in team
        ]
        data = {
            "id": str(channel.id),
            "channelId": str(channel.id),
            "channelName": channel.name,
            "guildId": str(guild.id),
            "map": None,
            "createdAt": int(time.time() * 1000),
            "members": members,
        }
        await db.execute(
            "CREATE TABLE IF NOT EXISTS web_lobbies "
            "(id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)"
        )
        new_ids = {m["discordId"] for m in members}
        rows = await db.fetchall("SELECT id, data FROM web_lobbies")
        for row in rows:
            try:
                old = json.loads(row[1])
            except (json.JSONDecodeError, TypeError):
                await db.execute("DELETE FROM web_lobbies WHERE id = ?", (row[0],))
                continue
            if any(m.get("discordId") in new_ids for m in old.get("members", [])):
                await db.execute("DELETE FROM web_lobbies WHERE id = ?", (row[0],))
        await db.execute(
            "INSERT OR REPLACE INTO web_lobbies (id, data, created_at) VALUES (?, ?, ?)",
            (data["id"], json.dumps(data), data["createdAt"]),
        )
    except Exception:
        logger.exception("Failed to persist web lobby")


async def _clear_web_lobbies() -> None:
    """Drop all post-queue lobby rows (used by /resetqueue and /resetdb)."""
    try:
        await db.execute("DELETE FROM web_lobbies")
    except Exception:
        logger.exception("Failed to clear web_lobbies")


async def _active_lobby_member_ids() -> set[int]:
    """Discord ids of everyone currently in a live match lobby (across all
    lobbies). A player is "in a match" until their match channel is deleted,
    which drops the row — see the on_guild_channel_delete listener."""
    try:
        rows = await db.fetchall("SELECT data FROM web_lobbies")
    except Exception:
        return set()
    ids: set[int] = set()
    for row in rows:
        try:
            data = json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            continue
        for m in data.get("members", []):
            try:
                ids.add(int(m["discordId"]))
            except (KeyError, ValueError, TypeError):
                continue
    return ids


async def _delete_web_lobby(channel_id: int) -> None:
    """Remove the lobby row tied to a match channel (called when it's deleted)."""
    try:
        await db.execute("DELETE FROM web_lobbies WHERE id = ?", (str(channel_id),))
    except Exception:
        logger.exception("Failed to delete web_lobby for channel %s", channel_id)


async def _save_queue_mode(team_size: int) -> None:
    """Persist the /gamemode choice so it survives bot restarts."""
    await db.execute(
        "CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT)"
    )
    await db.execute(
        "INSERT OR REPLACE INTO bot_state (key, value) VALUES ('queue_mode', ?)",
        (str(team_size),),
    )


async def _load_queue_mode() -> int | None:
    """Return the persisted queue team size, or ``None`` if unset/malformed."""
    try:
        row = await db.fetchone("SELECT value FROM bot_state WHERE key = 'queue_mode'")
    except Exception:
        return None
    try:
        return int(row[0]) if row and row[0] else None
    except (TypeError, ValueError):
        return None


async def _load_queue_message_ref():
    """Return the persisted ``(channel_id, message_id)`` of the queue message,
    or ``None`` if unset/malformed."""
    try:
        row = await db.fetchone("SELECT value FROM bot_state WHERE key = 'queue_message'")
    except Exception:
        return None
    if not row or not row[0]:
        return None
    try:
        channel_id, message_id = str(row[0]).split(":")
        return int(channel_id), int(message_id)
    except (ValueError, AttributeError):
        return None


class QueueView(View):
    def __init__(self):
        super().__init__(timeout=None)
        self.message = None

    async def recreate_queue_message(self, channel):
        try:
            if self.message:
                try:
                    old = await channel.fetch_message(self.message.id)
                    await old.delete()
                except (discord.NotFound, discord.HTTPException, discord.Forbidden):
                    pass
        except Exception:
            pass
        self.message = await channel.send(embed=self.get_queue_embed(), view=self)

    def get_queue_embed(self):
        current_queue = get_current_queue()
        queue_is_full = len(current_queue) >= GAME.queue_size and all(
            item.disabled for item in self.children
        )
        if queue_is_full:
            embed = discord.Embed(
                title="🎮 Game has started!",
                description="Wait for a new queue to start.",
                color=discord.Color.green(),
            )
            embed.add_field(name="Status", value="Queue is currently closed", inline=False)
            embed.set_footer(text="A new queue will be available soon")
            return embed

        if not current_queue:
            members_list = "No one is in the queue."
        else:
            display_lines, processed = [], set()
            for member in current_queue:
                if member.id in processed:
                    continue
                member_party_ids = None
                for party_info in parties.values():
                    if member.id in party_info["members"]:
                        member_party_ids = party_info["members"]
                        break
                # Fall back to website parties (mirrored from web_parties) so
                # party members who queued from the site are grouped too.
                if member_party_ids is None:
                    member_party_ids = web_party_members.get(member.id)
                if member_party_ids:
                    party_in_queue = [m for m in current_queue if m.id in member_party_ids]
                    if len(party_in_queue) > 1:
                        display_lines.append("👥 " + " ".join(m.mention for m in party_in_queue))
                        processed.update(p.id for p in party_in_queue)
                    else:
                        display_lines.append(member.mention)
                        processed.add(member.id)
                else:
                    display_lines.append(member.mention)
                    processed.add(member.id)
            members_list = "\n".join(f"{i+1}. {line}" for i, line in enumerate(display_lines))

        embed = discord.Embed(
            title="Queue System",
            description="Use the buttons below to join or leave the queue.",
            color=discord.Color.blue(),
        )
        embed.add_field(name="Current Queue", value=members_list, inline=False)
        embed.set_footer(
            text=f"Queue size: {len(current_queue)}/{GAME.queue_size} · {GAME.team_size}v{GAME.team_size}"
        )
        return embed

    async def update_queue_message(self):
        try:
            if self.message:
                await self.message.edit(embed=self.get_queue_embed())
        except discord.errors.HTTPException as e:
            if e.code == 50027 and hasattr(self.message, "channel"):
                await self.recreate_queue_message(self.message.channel)

    async def create_game_channel(self, guild: discord.Guild, players):
        """Create the private game channel, balance teams, and start the map veto.

        Takes a ``guild`` directly (not an ``interaction``) so both the Join
        button and the web-queue poll loop can start a match the same way.
        """
        # Empty the queue that just filled and start a fresh one. We must NOT use
        # get_current_queue().clear() here: the filled queue has len ==
        # queue_size, so get_current_queue() would roll over to a new empty queue
        # and we'd clear THAT, leaving the full queue (and its players) stuck.
        # Any overflow players (who joined beyond queue_size) carry over.
        started_ids = {p.id for p in players}
        if queues:
            leftover = [m for m in queues[-1] if m.id not in started_ids]
            queues[-1].clear()
            queues.append(leftover)
        else:
            queues.append([])

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False, send_messages=False)
        }
        match_staff_role = discord.utils.get(guild.roles, name=MATCH_STAFF_ROLE)
        if match_staff_role:
            overwrites[match_staff_role] = discord.PermissionOverwrite(
                read_messages=True, send_messages=True, read_message_history=True
            )
        for player in players:
            overwrites[player] = discord.PermissionOverwrite(
                read_messages=True, send_messages=True, read_message_history=True
            )

        channel = await guild.create_text_channel(
            f"queue-game-{len(queues)}", overwrites=overwrites, reason="Queue game channel"
        )
        queue_channels[len(queues) - 1] = channel
        queue_players[channel.id] = list(players)

        await channel.send(f"**Game starting!** {' '.join(p.mention for p in players)}")

        # Player Elos + party blocks.
        player_elos, player_parties = {}, {}
        for player in players:
            row = await db.fetchone(
                "SELECT elo FROM players WHERE name = ?", (player.display_name,)
            )
            player_elos[player] = row[0] if row else 0
            for leader_id, party in parties.items():
                if player.id in party["members"]:
                    party_members = [p for p in players if p.id in party["members"]]
                    if len(party_members) > 1:
                        player_parties[leader_id] = party_members

        def effective_elo(p):
            e = player_elos.get(p, 0)
            return GAME.elo.unranked_effective_elo if e == 0 else e

        blocks, used = [], set()
        for leader_id, members in player_parties.items():
            members = [m for m in members if m in players]
            if not members:
                continue
            blocks.append((members, sum(effective_elo(m) for m in members), len(members)))
            used.update(members)
        for p in players:
            if p not in used:
                blocks.append(([p], effective_elo(p), 1))

        players_per_team = len(players) // 2

        def choose_balanced_teams(blocks, players_per_team):
            best, best_diff = None, float("inf")
            n = len(blocks)
            for r in range(1, n + 1):
                for combo in itertools.combinations(range(n), r):
                    if sum(blocks[i][2] for i in combo) != players_per_team:
                        continue
                    t1_elo = sum(blocks[i][1] for i in combo)
                    t2_elo = sum(b[1] for idx, b in enumerate(blocks) if idx not in combo)
                    t2_count = len(players) - players_per_team
                    if t2_count == 0:
                        continue
                    diff = abs(t1_elo / players_per_team - t2_elo / t2_count)
                    if diff < best_diff:
                        best_diff, best = diff, combo
            if best is not None:
                team1, team2 = [], []
                for idx, (members, _, _) in enumerate(blocks):
                    (team1 if idx in best else team2).extend(members)
                return team1, team2

            sorted_blocks = sorted(blocks, key=lambda b: (b[1] / b[2]) if b[2] else 0, reverse=True)
            team1, team2 = [], []
            t1c = t2c = t1e = t2e = 0
            for members, total_elo, size in sorted_blocks:
                if t1c + size <= players_per_team and (t1c < t2c or t1e > t2e):
                    team2.extend(members); t2c += size; t2e += total_elo
                elif t1c + size <= players_per_team:
                    team1.extend(members); t1c += size; t1e += total_elo
                else:
                    team2.extend(members); t2c += size; t2e += total_elo
            return team1, team2

        team1, team2 = choose_balanced_teams(blocks, players_per_team)
        if not team1 or not team2:
            await channel.send("Error: failed to form balanced teams.")
            return

        def avg_elo(team):
            return sum(effective_elo(m) for m in team) / max(len(team), 1)

        avg1, avg2 = avg_elo(team1), avg_elo(team2)
        logger.info(f"Team1 avg ELO: {avg1:.1f} (n={len(team1)}) | Team2 avg ELO: {avg2:.1f} (n={len(team2)})")

        captain1 = random.choice(team1)
        captain2 = random.choice(team2)

        teams_embed = discord.Embed(title="Teams Selected!", color=discord.Color.blue())
        teams_embed.add_field(
            name="Team 1",
            value=f"Captain: {captain1.mention} (Avg ELO: {avg1:.1f})\nPlayers: {', '.join(p.mention for p in team1)}",
            inline=False,
        )
        teams_embed.add_field(
            name="Team 2",
            value=f"Captain: {captain2.mention} (Avg ELO: {avg2:.1f})\nPlayers: {', '.join(p.mention for p in team2)}",
            inline=False,
        )
        await channel.send(embed=teams_embed)

        # Persist a post-queue lobby so website players see their match (teams +
        # a link to this Discord channel) after the queue fills.
        await _persist_web_lobby(channel, guild, team1, team2)

        coin_flip = random.choice([captain1, captain2])
        await channel.send(f"🎲 **Coin flip result:** {coin_flip.mention} will start the map selection!")
        if coin_flip == captain1:
            maps_view = MapVoteView(coin_flip.id, captain2.id, captain1.id, captain2.id)
        else:
            maps_view = MapVoteView(coin_flip.id, captain1.id, captain1.id, captain2.id)
        await channel.send("**Map Selection Phase**\nRemaining maps:", view=maps_view)

    @discord.ui.button(
        label="Join Queue", style=discord.ButtonStyle.green, custom_id="sfhl:queue:join"
    )
    async def join_button(self, interaction: discord.Interaction, button: Button):
        # After a restart the persistent view has no stored message; adopt the one
        # the button lives on so queue-message edits keep working.
        if self.message is None:
            self.message = interaction.message
        try:
            current_queue = get_current_queue()
            if interaction.user in current_queue:
                await interaction.response.send_message(
                    f"{interaction.user.mention}, you are already in the queue.", ephemeral=True
                )
                return

            party_members, is_party_member = [], False
            party_member_ids = [interaction.user.id]
            for leader_id, party in parties.items():
                if interaction.user.id in party["members"]:
                    is_party_member = True
                    party_member_ids = list(party["members"])
                    party_members = [
                        interaction.guild.get_member(mid) for mid in party["members"]
                    ]
                    break

            # Can't queue while still in a live match — the web_lobby row exists
            # until that match's channel is deleted. Blocks the whole party if
            # any member is still in a match.
            active_lobby = await _active_lobby_member_ids()
            blocked_ids = [i for i in party_member_ids if i in active_lobby]
            if blocked_ids:
                mentions = ", ".join(f"<@{i}>" for i in blocked_ids)
                await interaction.response.send_message(
                    f"Cannot join queue: {mentions} still in a match. "
                    "Finish it (or wait for the match channel to be closed) first.",
                    ephemeral=True,
                )
                return

            def is_blacklisted(member):
                return member is not None and discord.utils.get(member.roles, name=BLACKLIST_ROLE) is not None

            if is_party_member:
                blacklisted = [m for m in party_members if is_blacklisted(m)]
                if blacklisted:
                    await interaction.response.send_message(
                        f"Cannot join queue: {' ,'.join(m.mention for m in blacklisted)} is blacklisted.",
                        ephemeral=True,
                    )
                    return
                if len(current_queue) + len(party_members) > GAME.queue_size:
                    await interaction.response.send_message(
                        "Not enough space in the queue for your entire party.", ephemeral=True
                    )
                    return
                for member in party_members:
                    if member not in current_queue:
                        current_queue.append(member)
                await interaction.response.send_message(
                    f"Party members {', '.join(m.mention for m in party_members)} have joined the queue.",
                    ephemeral=True,
                )
            else:
                if is_blacklisted(interaction.user):
                    await interaction.response.send_message(
                        "Cannot join queue: You are blacklisted.", ephemeral=True
                    )
                    return
                current_queue.append(interaction.user)
                await interaction.response.send_message(
                    f"{interaction.user.mention} has joined the queue.", ephemeral=True
                )

            await self.update_queue_message()

            if len(current_queue) >= GAME.queue_size:
                for item in self.children:
                    item.disabled = True
                await self.message.edit(embed=self.get_queue_embed(), view=self)
                await self.create_game_channel(interaction.guild, current_queue[: GAME.queue_size])
        except discord.InteractionResponded:
            await self.recreate_queue_message(interaction.channel)
            try:
                await interaction.followup.send(
                    "The queue message has expired and been recreated. Please try again.",
                    ephemeral=True,
                )
            except discord.HTTPException:
                pass

    @discord.ui.button(
        label="Leave Queue", style=discord.ButtonStyle.red, custom_id="sfhl:queue:leave"
    )
    async def leave_button(self, interaction: discord.Interaction, button: Button):
        if self.message is None:
            self.message = interaction.message
        try:
            current_queue = get_current_queue()
            party = None
            for leader_id, p in parties.items():
                if interaction.user.id in p["members"]:
                    party = p
                    break

            if party:
                removed = []
                for member_id in party["members"]:
                    member = interaction.guild.get_member(member_id)
                    if member and member in current_queue:
                        current_queue.remove(member)
                        removed.append(member.mention)
                if removed:
                    await interaction.response.send_message(
                        f"Party members {', '.join(removed)} have left the queue.", ephemeral=True
                    )
                else:
                    await interaction.response.send_message(
                        "No party members were in the queue.", ephemeral=True
                    )
            else:
                if interaction.user in current_queue:
                    current_queue.remove(interaction.user)
                    await interaction.response.send_message(
                        f"{interaction.user.mention} has left the queue.", ephemeral=True
                    )
                else:
                    await interaction.response.send_message(
                        f"{interaction.user.mention}, you are not in the queue.", ephemeral=True
                    )
            await self.update_queue_message()
        except discord.InteractionResponded:
            await self.recreate_queue_message(interaction.channel)
            try:
                await interaction.followup.send(
                    "The queue message has expired and been recreated. Please try again.",
                    ephemeral=True,
                )
            except discord.HTTPException:
                pass


class PartyInviteView(View):
    def __init__(self, leader_id: int, invited_id: int):
        super().__init__(timeout=None)
        self.leader_id = leader_id
        self.invited_id = invited_id

    @discord.ui.button(label="Accept", style=discord.ButtonStyle.green)
    async def accept(self, interaction: discord.Interaction, button: Button):
        if interaction.user.id != self.invited_id:
            await interaction.response.send_message("This invite is not for you!", ephemeral=True)
            return
        if self.leader_id not in parties:
            await interaction.response.send_message("The party no longer exists!", ephemeral=True)
            return
        party = parties[self.leader_id]
        if len(party["members"]) >= 5:
            await interaction.response.send_message(
                "The party is now full! Maximum of 5 players per party.", ephemeral=True
            )
            return
        party["members"].append(self.invited_id)
        self._disable_all()
        await interaction.response.edit_message(content="You have joined the party!", view=self)

    @discord.ui.button(label="Decline", style=discord.ButtonStyle.red)
    async def decline(self, interaction: discord.Interaction, button: Button):
        if interaction.user.id != self.invited_id:
            await interaction.response.send_message("This invite is not for you!", ephemeral=True)
            return
        self._disable_all()
        await interaction.response.edit_message(content="You declined the party invite.", view=self)

    def _disable_all(self):
        for child in self.children:
            child.disabled = True


class QueueCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # One persistent QueueView drives the live queue message. Keeping a
        # single shared instance (instead of a throwaway per /queue) means the
        # web-queue sync task can refresh the very same message the Join/Leave
        # buttons edit, and the buttons keep working after a restart.
        self.queue_view = QueueView()
        bot.add_view(self.queue_view)
        # Queue membership as of the last web<->Discord reconciliation. Diffing
        # this against both sides each poll tells us who joined/left on the
        # website vs. in Discord, so we can mirror each change the other way.
        self._last_synced_ids: set[int] = set()
        self.poll_web_queue.start()

    async def cog_load(self):
        # Restore the persisted queue format (5v5/1v1) across restarts.
        team_size = await _load_queue_mode()
        if team_size in QUEUE_MODES and team_size != GAME.team_size:
            set_team_size(team_size)
            logger.info("Restored queue mode: %sv%s", team_size, team_size)

    def cog_unload(self):
        self.poll_web_queue.cancel()

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel: discord.abc.GuildChannel):
        """When a match channel is deleted, free its players: drop the web_lobby
        row (so they can queue again) and forget the in-memory game state. This
        is the signal that a match is over."""
        if channel.id in queue_players:
            queue_players.pop(channel.id, None)
            for idx, ch in list(queue_channels.items()):
                if getattr(ch, "id", None) == channel.id:
                    queue_channels.pop(idx, None)
        await _delete_web_lobby(channel.id)

    @tasks.loop(seconds=5.0)
    async def poll_web_queue(self):
        """Two-way sync between the website's web_queue table and the live
        in-memory Discord queue.

        The table is the shared state the website reads and writes; the
        in-memory queue is what the Discord message and matchmaking use. Each
        poll we diff both against the membership we last reconciled to work out
        who changed on which side, then mirror the change the other way:

          * joined on the website   -> add to the Discord queue
          * left on the website     -> remove from the Discord queue
          * joined via Discord       -> insert a row so the website shows them
          * left via Discord / match -> delete their row

        Diffing against the last-synced set (rather than one-way "consume the
        intent") keeps both sides in agreement no matter where the change came
        from, so joins/leaves on either side show up on the other.
        """
        try:
            from config.settings import GUILD_ID
            guild = self.bot.get_guild(GUILD_ID)
            if not guild:
                return

            rows = await db.fetchall("SELECT discord_user_id FROM web_queue")
            db_ids = {int(row[0]) for row in rows}

            # Refresh the website-party grouping cache so get_queue_embed can
            # group web-party members with 👥 (it can't hit the DB itself).
            await self._refresh_web_party_cache()

            current_queue = get_current_queue()
            mem_ids = {m.id for m in current_queue}
            last = self._last_synced_ids

            added_web = db_ids - last          # joined via the website
            removed_web = last - db_ids        # left via the website
            added_discord = mem_ids - last     # joined via Discord
            removed_discord = last - mem_ids   # left via Discord (or match start)

            unresolved: set[int] = set()

            # Resolve every website join synchronously first (no awaits), so we
            # decide who to add/drop against a consistent snapshot, then do all
            # DB writes, then mutate the in-memory queue in one synchronous block
            # at the end. This avoids holding a stale queue reference across the
            # awaits (a match start / button click could otherwise mutate it
            # mid-loop).
            to_append = []          # members to add to the in-memory queue
            drop_web_rows: list[int] = []  # web_queue rows to delete
            for uid in added_web:
                if uid in mem_ids:
                    continue  # already queued (joined on both sides at once)
                member = guild.get_member(uid)
                if member is None:
                    logger.warning(f"Web queue user {uid} not found in guild; dropping.")
                    drop_web_rows.append(uid)
                    unresolved.add(uid)
                    continue
                # Enforce the blacklist here too — otherwise a blacklisted user
                # could bypass the Join-button check by queueing from the website.
                if discord.utils.get(member.roles, name=BLACKLIST_ROLE) is not None:
                    logger.info(f"Web queue user {member.display_name} is blacklisted; dropping.")
                    drop_web_rows.append(uid)
                    unresolved.add(uid)
                    continue
                to_append.append(member)

            # Build all DB writes: drops (unresolved/blacklisted), Discord-join
            # mirrors, and Discord-leave/match-start removals.
            stmts: list = []
            for uid in drop_web_rows:
                stmts.append(("DELETE FROM web_queue WHERE discord_user_id = ?", (str(uid),)))
            for uid in added_discord:
                if uid in db_ids:
                    continue
                member = guild.get_member(uid)
                name = member.display_name if member else str(uid)
                stmts.append((
                    "INSERT OR REPLACE INTO web_queue "
                    "(discord_user_id, discord_username, player_name) VALUES (?, ?, ?)",
                    (str(uid), name, name),
                ))
            for uid in removed_discord:
                stmts.append(("DELETE FROM web_queue WHERE discord_user_id = ?", (str(uid),)))
            if stmts:
                await db.batch(stmts)

            # Apply the in-memory queue changes last, synchronously, against the
            # live queue (re-fetched in case it rolled over during the awaits).
            queue_changed = False
            live_queue = get_current_queue()
            for member in to_append:
                if member not in live_queue:
                    live_queue.append(member)
                    queue_changed = True
                    logger.info(f"Added web user {member.display_name} to Discord queue.")
            for uid in removed_web:
                member = guild.get_member(uid)
                if member and member in live_queue:
                    live_queue.remove(member)
                    queue_changed = True
                    logger.info(f"Removed {member.display_name} from Discord queue (left via site).")
            current_queue = live_queue

            # Membership both sides now agree on, for next poll's diff.
            self._last_synced_ids = (
                (last | (added_web - unresolved) | added_discord)
                - removed_web
                - removed_discord
            )

            if queue_changed:
                await self._refresh_queue_message()
                # Auto-start a web-filled queue the same way the Join button
                # does — but only when staff have an open queue message (so a
                # match never spawns out of nowhere). create_game_channel empties
                # the filled queue and persists the post-queue lobby.
                if len(current_queue) >= GAME.queue_size and self.queue_view.message is not None:
                    players = current_queue[: GAME.queue_size]
                    for item in self.queue_view.children:
                        item.disabled = True
                    await self._refresh_queue_message()
                    await self.queue_view.create_game_channel(guild, players)
                elif len(current_queue) >= GAME.queue_size:
                    logger.info(
                        "Queue filled from the website but no open queue message; "
                        "run /queue in Discord to start the match."
                    )

        except Exception as e:
            logger.error(f"Error polling web queue: {e}")

    async def _refresh_queue_message(self):
        """Edit the live queue message to reflect the current queue.

        Recovers the message handle after a restart from the persisted
        channel/message ids so web-driven changes still update the embed even if
        nobody has clicked a button this session.
        """
        view = self.queue_view
        if view.message is None:
            ref = await _load_queue_message_ref()
            if ref:
                channel = self.bot.get_channel(ref[0])
                if channel is not None:
                    try:
                        view.message = await channel.fetch_message(ref[1])
                    except (discord.NotFound, discord.HTTPException, discord.Forbidden):
                        view.message = None
        if view.message is not None:
            await view.update_queue_message()

    async def _refresh_web_party_cache(self):
        """Rebuild the shared web-party grouping map from the web_parties table.

        Maps every member's Discord id to the list of all member ids in their
        website party, so the queue embed can group them. Mutated in place so
        the reference imported elsewhere stays valid.
        """
        try:
            rows = await db.fetchall("SELECT data FROM web_parties")
        except Exception:
            # Table may not exist yet (no party ever created); leave cache as-is.
            return
        new_map: dict[int, list[int]] = {}
        for row in rows:
            try:
                party = json.loads(row[0])
                member_ids = [
                    int(m["discordId"])
                    for m in party.get("members", [])
                    if m.get("discordId")
                ]
            except (json.JSONDecodeError, TypeError, ValueError, KeyError):
                continue
            if len(member_ids) > 1:
                for mid in member_ids:
                    new_map[mid] = member_ids
        web_party_members.clear()
        web_party_members.update(new_map)

    @app_commands.command(name="queue", description="Open a matchmaking queue (Match Staff only).")
    async def queue_command(self, interaction: discord.Interaction):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        view = self.queue_view
        # Re-enable the buttons: a previous match start disabled them on the
        # shared persistent view, and without this reset every queue after the
        # first would open with dead Join/Leave buttons.
        for item in view.children:
            item.disabled = False
        await interaction.response.send_message(embed=view.get_queue_embed(), view=view)
        view.message = await interaction.original_response()
        await _save_queue_message_ref(view.message.channel.id, view.message.id)

    @app_commands.command(
        name="resetqueue", description="Clear the current queue and parties (Match Staff only)."
    )
    async def reset_queue(self, interaction: discord.Interaction):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        n_players = sum(len(q) for q in queues)
        n_parties = len(parties)
        queues.clear()
        queue_channels.clear()
        queue_players.clear()
        parties.clear()
        # Clear the website's mirror too, and reset the sync baseline so the next
        # poll doesn't try to re-add anyone.
        self._last_synced_ids.clear()
        try:
            await db.execute("DELETE FROM web_queue")
        except Exception:
            logger.exception("Failed to clear web_queue on /resetqueue")
        await _clear_web_lobbies()
        # Re-enable buttons in case a match start left them disabled.
        for item in self.queue_view.children:
            item.disabled = False
        await self._refresh_queue_message()
        await interaction.response.send_message(
            f"✅ Queue reset. Cleared {n_players} queued player(s) and {n_parties} party(ies). "
            "Run `/queue` to start a fresh one.",
            ephemeral=True,
        )

    @app_commands.command(
        name="cancelqueue",
        description="Remove every player from the queue, keeping parties (Match Staff only).",
    )
    async def cancel_queue(self, interaction: discord.Interaction):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        n_players = sum(len(q) for q in queues)
        # Empty only the pending queues — parties and any in-progress game
        # channels (queue_channels / queue_players) are left untouched.
        queues.clear()
        # Clear the website's mirror too, and reset the sync baseline so the
        # next poll doesn't try to re-add anyone.
        self._last_synced_ids.clear()
        try:
            await db.execute("DELETE FROM web_queue")
        except Exception:
            logger.exception("Failed to clear web_queue on /cancelqueue")
        await self._refresh_queue_message()
        await interaction.response.send_message(
            f"🚫 Queue cancelled — removed {n_players} queued player(s). Parties were kept.",
            ephemeral=True,
        )

    @app_commands.command(
        name="gamemode",
        description="Switch the global queue format between 5v5 and 1v1 (Match Staff only).",
    )
    @app_commands.describe(mode="The queue format to switch to")
    @app_commands.choices(
        mode=[
            app_commands.Choice(name="5v5", value=5),
            app_commands.Choice(name="1v1", value=1),
        ]
    )
    async def gamemode(self, interaction: discord.Interaction, mode: app_commands.Choice[int]):
        if not has_required_role(interaction):
            await interaction.response.send_message(
                "You do not have the required role ('[MS] Match Staff') to use this command.",
                ephemeral=True,
            )
            return
        team_size = mode.value
        label = QUEUE_MODES[team_size]
        if team_size == GAME.team_size:
            await interaction.response.send_message(
                f"The queue is already in **{label}** mode.", ephemeral=True
            )
            return
        # A pending queue sized for the old format makes no sense in the new
        # one — empty it (parties are kept), like /cancelqueue.
        n_players = sum(len(q) for q in queues)
        queues.clear()
        self._last_synced_ids.clear()
        try:
            await db.execute("DELETE FROM web_queue")
        except Exception:
            logger.exception("Failed to clear web_queue on /gamemode")
        set_team_size(team_size)
        await _save_queue_mode(team_size)
        await self._refresh_queue_message()
        await interaction.response.send_message(
            f"🎮 Queue format switched to **{label}** (queue fills at {GAME.queue_size}). "
            f"Cleared {n_players} queued player(s); parties were kept.",
            ephemeral=True,
        )

    @app_commands.command(name="createparty", description="Create a party")
    async def create_party(self, interaction: discord.Interaction):
        if interaction.user.id in parties or any(
            interaction.user.id in p["members"] for p in parties.values()
        ):
            await interaction.response.send_message(
                "You are already in a party. Leave your current party first.", ephemeral=True
            )
            return
        parties[interaction.user.id] = {"members": [interaction.user.id]}
        await interaction.response.send_message(
            "Party created! Use /invite to add players (up to 5 players total for now).",
            ephemeral=True,
        )

    @app_commands.command(name="invite", description="Invite a player to your party")
    async def invite_player(self, interaction: discord.Interaction, player: discord.Member):
        if interaction.user.id not in parties:
            await interaction.response.send_message(
                "You don't have a party. Create one first with /createparty.", ephemeral=True
            )
            return
        party = parties[interaction.user.id]
        if len(party["members"]) >= 5:
            await interaction.response.send_message(
                "Your party is full! Maximum of 5 players per party (for now).", ephemeral=True
            )
            return
        if player.id in party["members"]:
            await interaction.response.send_message(
                "This player is already in your party!", ephemeral=True
            )
            return
        if any(player.id in p["members"] for p in parties.values()):
            await interaction.response.send_message(
                "This player is already in another party!", ephemeral=True
            )
            return
        await player.send(
            f"{interaction.user.display_name} invited you to their party!",
            view=PartyInviteView(interaction.user.id, player.id),
        )
        await interaction.response.send_message(
            f"Invitation sent to {player.display_name}!", ephemeral=True
        )

    @app_commands.command(name="leaveparty", description="Leave your current party")
    async def leave_party(self, interaction: discord.Interaction):
        current_queue = get_current_queue()
        queue_updated = False

        if interaction.user.id in parties:
            party_members = [
                interaction.guild.get_member(mid)
                for mid in parties[interaction.user.id]["members"]
            ]
            for member in party_members:
                if member in current_queue:
                    current_queue.remove(member)
                    queue_updated = True
            del parties[interaction.user.id]
            message = "Party disbanded since you were the leader."
            if queue_updated:
                message += " All party members have been removed from the queue."
            await interaction.response.send_message(message, ephemeral=True)
            return

        for leader_id, party in parties.items():
            if interaction.user.id in party["members"]:
                member = interaction.guild.get_member(interaction.user.id)
                if member in current_queue:
                    current_queue.remove(member)
                    queue_updated = True
                party["members"].remove(interaction.user.id)
                message = "You have left the party."
                if queue_updated:
                    message += " You have been removed from the queue."
                if len(party["members"]) <= 1:
                    del parties[leader_id]
                    leader = interaction.guild.get_member(leader_id)
                    if leader:
                        try:
                            await leader.send(
                                "Your party has been disbanded because all members left."
                            )
                        except discord.HTTPException:
                            pass
                await interaction.response.send_message(message, ephemeral=True)
                return

        await interaction.response.send_message("You are not in a party.", ephemeral=True)

    @app_commands.command(
        name="viewparty", description="View the current party members and their details."
    )
    async def view_party(self, interaction: discord.Interaction):
        party = parties.get(interaction.user.id)
        if party is None:
            for p in parties.values():
                if interaction.user.id in p["members"]:
                    party = p
                    break
        if party is None:
            await interaction.response.send_message("You are not in a party.", ephemeral=True)
            return

        embed = discord.Embed(
            title="Party Members", description="Details of all party members",
            color=discord.Color.blue(),
        )
        try:
            for member_id in party["members"]:
                member = interaction.guild.get_member(member_id)
                if not member:
                    continue
                result = await db.fetchone(
                    """SELECT elo, rank, matches_played, matches_won, placement_games_played
                       FROM players WHERE name = ?""",
                    (member.display_name,),
                )
                if result:
                    elo, rank, matches_played, matches_won, placement_games = result
                    if rank == "[?] Unranked":
                        stats = f"Unranked\n Placement Progress: {placement_games}/3"
                    else:
                        win_rate = (matches_won / matches_played * 100) if matches_played > 0 else 0
                        stats = (
                            f"Rank: {rank}\n Elo: {elo}\n Games Played: {matches_played}\n "
                            f"Win Rate: {win_rate:.1f}%"
                        )
                    is_leader = (
                        member_id in parties
                        and parties[member_id]["members"] == party["members"]
                    )
                    name = f"👑 {member.display_name}" if is_leader else member.display_name
                    embed.add_field(name=name, value=stats, inline=False)
                else:
                    embed.add_field(
                        name=member.display_name,
                        value="❌ No data available - Player needs to be added to the system",
                        inline=False,
                    )
        except Exception as e:
            logger.error(f"Database error in viewparty: {e}")
            await interaction.response.send_message(
                "An error occurred while fetching party data.", ephemeral=True
            )
            return
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(QueueCog(bot))
