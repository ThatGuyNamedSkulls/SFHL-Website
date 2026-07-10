"""Cross-cutting helpers shared by multiple cogs (and main.py).

Kept out of ``core/`` because these touch Discord objects; kept out of
``main.py`` so cogs can import them without a circular dependency.
"""

import discord
from discord import app_commands

from config.settings import MATCH_STAFF_ROLE
from core import db


def has_required_role(interaction: discord.Interaction, role_name: str = MATCH_STAFF_ROLE) -> bool:
    """Return True if the interacting user has the named role."""
    return discord.utils.get(interaction.user.roles, name=role_name) is not None


async def player_name_choices(current: str):
    """Up to 5 player-name autocomplete choices matching `current` (case-insensitive)."""
    try:
        rows = await db.fetchall(
            "SELECT name FROM players WHERE name LIKE ? LIMIT 5", (f"%{current}%",)
        )
        return [app_commands.Choice(name=r[0], value=r[0]) for r in rows]
    except Exception:
        return []


async def item_slug_choices(current: str):
    """Up to 10 cosmetic-item autocomplete choices (label "name (slug)", value slug)."""
    try:
        rows = await db.fetchall(
            "SELECT slug, name FROM cosmetic_items WHERE slug LIKE ? OR name LIKE ? LIMIT 10",
            (f"%{current}%", f"%{current}%"),
        )
        return [
            app_commands.Choice(name=f"{r[1]} ({r[0]})"[:100], value=r[0]) for r in rows
        ]
    except Exception:
        return []


async def item_slug_choices_off_shop(current: str):
    """Like :func:`item_slug_choices` but limited to items NOT currently on the
    shop (price 0 or NULL) — used by /setprice to add an item to the shop."""
    try:
        rows = await db.fetchall(
            "SELECT slug, name FROM cosmetic_items "
            "WHERE (slug LIKE ? OR name LIKE ?) AND COALESCE(price, 0) = 0 LIMIT 10",
            (f"%{current}%", f"%{current}%"),
        )
        return [
            app_commands.Choice(name=f"{r[1]} ({r[0]})"[:100], value=r[0]) for r in rows
        ]
    except Exception:
        return []
