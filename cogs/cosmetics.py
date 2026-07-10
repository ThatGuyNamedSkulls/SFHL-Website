"""Cosmetics admin commands: manage the profile-customization catalog and
player inventories (profile cards, titles, badge items).

All commands are admin-gated (guild administrator, matching /addbadge).
Players equip their items on the website (sf-hl.com/settings); granting and
revoking happens here. Logic lives in core/cosmetics.py so events and tasks
can grant items through the same path.
"""

import logging

import discord
from discord import app_commands
from discord.ext import commands

from core.cosmetics import (
    delete_item,
    ensure_item,
    get_coins,
    get_inventory,
    get_item,
    grant_coins,
    grant_item,
    list_items,
    revoke_item,
    set_price,
    valid_slug,
)
from cogs.shared import item_slug_choices, item_slug_choices_off_shop, player_name_choices

logger = logging.getLogger(__name__)

# Slash-command choice lists.
_TYPE_CHOICES = [
    app_commands.Choice(name="Profile Card", value="card"),
    app_commands.Choice(name="Avatar Frame", value="frame"),
    app_commands.Choice(name="Title", value="title"),
    app_commands.Choice(name="Badge", value="badge"),
]
_RARITY_CHOICES = [
    app_commands.Choice(name="Common", value="common"),
    app_commands.Choice(name="Rare", value="rare"),
    app_commands.Choice(name="Epic", value="epic"),
    app_commands.Choice(name="Legendary", value="legendary"),
]
_CATEGORY_CHOICES = [
    app_commands.Choice(name="Admin", value="admin"),
    app_commands.Choice(name="Seasonal", value="seasonal"),
    app_commands.Choice(name="Team", value="team"),
]

_TYPE_LABEL = {"card": "Profile Card", "frame": "Avatar Frame", "title": "Title", "badge": "Badge"}
# Asset folder by item type (under the website's public/).
_ASSET_PREFIX = {"card": "/profilecards/", "frame": "/avatarframes/", "title": None, "badge": "/badgeicons/"}


def _is_admin(interaction: discord.Interaction) -> bool:
    return interaction.user.guild_permissions.administrator


async def _deny(interaction: discord.Interaction):
    await interaction.response.send_message(
        "You need administrator permissions to use this command.", ephemeral=True
    )


class CosmeticsCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="createitem",
        description="Create a cosmetic item (profile card / title / badge). Admin only.",
    )
    @app_commands.describe(
        item_type="What kind of item this is.",
        slug="Stable id: lowercase letters, digits, dashes (e.g. s1-gold-card).",
        name="Display name. For titles this IS the title text shown on profiles.",
        description="Shown in the inventory and badge tooltips.",
        asset_filename="Image filename (e.g. gold.png) in the site's asset folder for this type.",
        category="Badge category (admin/seasonal/team).",
        rarity="Rarity accent shown in the inventory.",
        price="Shop price in HL Coins (0 = not for sale, grant-only).",
    )
    @app_commands.choices(item_type=_TYPE_CHOICES, rarity=_RARITY_CHOICES, category=_CATEGORY_CHOICES)
    async def create_item(
        self,
        interaction: discord.Interaction,
        item_type: str,
        slug: str,
        name: str,
        description: str = "",
        asset_filename: str = None,
        category: str = None,
        rarity: str = "common",
        price: int = 0,
    ):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        slug = slug.strip().lower()
        if not valid_slug(slug):
            await interaction.response.send_message(
                "Invalid slug — use 2-40 lowercase letters, digits, or dashes.", ephemeral=True
            )
            return
        if await get_item(slug) is not None:
            await interaction.response.send_message(
                f"An item with slug `{slug}` already exists.", ephemeral=True
            )
            return
        name = name.strip()
        if item_type == "title" and len(name) > 24:
            await interaction.response.send_message(
                "Title text must be 24 characters or fewer.", ephemeral=True
            )
            return
        asset = None
        prefix = _ASSET_PREFIX[item_type]
        if asset_filename and prefix:
            asset = prefix + asset_filename.strip().lstrip("/")
        price = max(0, price)
        await ensure_item(
            slug, item_type, name,
            description=description.strip(),
            asset=asset,
            category=category if item_type == "badge" else None,
            rarity=rarity,
            price=price,
        )
        embed = discord.Embed(
            title="Item Created",
            description=f"**{name}** (`{slug}`) — {_TYPE_LABEL[item_type]}, {rarity}",
            color=discord.Color.green(),
        )
        if asset:
            embed.add_field(
                name="Asset",
                value=f"`{asset}` (put the file in the website's `public{prefix}` folder)",
                inline=False,
            )
        embed.add_field(
            name="Shop price",
            value=f"{price} HL Coins" if price > 0 else "Not for sale (grant-only)",
            inline=False,
        )
        embed.set_footer(
            text=(f"In the shop for {price} coins." if price > 0
                  else f"Grant it with /giveitem <player> {slug}, or set a price with /setprice {slug} <coins>")
        )
        await interaction.response.send_message(embed=embed)

    @app_commands.command(
        name="deleteitem",
        description="Delete a cosmetic item from the catalog and all inventories. Admin only.",
    )
    async def delete_item_cmd(self, interaction: discord.Interaction, item_slug: str):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        if await delete_item(item_slug.strip().lower()):
            await interaction.response.send_message(
                f"Deleted `{item_slug}` from the catalog and every inventory."
            )
        else:
            await interaction.response.send_message(
                f"No item with slug `{item_slug}`.", ephemeral=True
            )

    @app_commands.command(
        name="giveitem", description="Give a cosmetic item to a player. Admin only."
    )
    async def give_item(
        self, interaction: discord.Interaction, player_name: str, item_slug: str
    ):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        result = await grant_item(
            player_name.strip(), item_slug.strip().lower(), interaction.user.display_name
        )
        messages = {
            "granted": f"✅ Gave `{item_slug}` to **{player_name}**. They can equip it at sf-hl.com/settings.",
            "already_owned": f"**{player_name}** already owns `{item_slug}`.",
            "no_such_item": f"No item with slug `{item_slug}` (see /listitems).",
            "no_such_player": f"Player '{player_name}' not found in the database.",
        }
        await interaction.response.send_message(
            messages[result], ephemeral=result != "granted"
        )

    @app_commands.command(
        name="givecoins",
        description="Give (or remove) HL Coins to a player — the shop currency. Admin only.",
    )
    @app_commands.describe(
        player_name="The player to adjust.",
        amount="Coins to add (use a negative number to remove).",
    )
    async def give_coins(
        self, interaction: discord.Interaction, player_name: str, amount: int
    ):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        new_balance = await grant_coins(player_name.strip(), amount)
        if new_balance is None:
            await interaction.response.send_message(
                f"Player '{player_name}' not found in the database.", ephemeral=True
            )
            return
        verb = "Gave" if amount >= 0 else "Removed"
        await interaction.response.send_message(
            f"🪙 {verb} **{abs(amount)}** HL Coins {'to' if amount >= 0 else 'from'} "
            f"**{player_name}**. New balance: **{new_balance}** coins. "
            "They can spend it at sf-hl.com/shop."
        )

    @app_commands.command(
        name="setprice",
        description="Set a cosmetic item's shop price in HL Coins (0 = not for sale). Admin only.",
    )
    @app_commands.describe(
        item_slug="The item to price.",
        price="Price in HL Coins (0 removes it from the shop).",
    )
    async def set_price_cmd(
        self, interaction: discord.Interaction, item_slug: str, price: int
    ):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        slug = item_slug.strip().lower()
        if not await set_price(slug, price):
            await interaction.response.send_message(
                f"No item with slug `{slug}` (see /listitems).", ephemeral=True
            )
            return
        price = max(0, price)
        if price > 0:
            msg = f"🏷️ `{slug}` is now in the shop for **{price}** HL Coins."
        else:
            msg = f"`{slug}` removed from the shop (grant-only)."
        await interaction.response.send_message(msg)

    @app_commands.command(
        name="revokeitem", description="Take a cosmetic item away from a player. Admin only."
    )
    async def revoke_item_cmd(
        self, interaction: discord.Interaction, player_name: str, item_slug: str
    ):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        if await revoke_item(player_name.strip(), item_slug.strip().lower()):
            await interaction.response.send_message(
                f"Revoked `{item_slug}` from **{player_name}**."
            )
        else:
            await interaction.response.send_message(
                f"**{player_name}** doesn't own `{item_slug}` (or the item doesn't exist).",
                ephemeral=True,
            )

    @app_commands.command(
        name="listitems", description="List the cosmetic item catalog. Admin only."
    )
    @app_commands.choices(item_type=_TYPE_CHOICES)
    async def list_items_cmd(
        self, interaction: discord.Interaction, item_type: str = None
    ):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        rows = await list_items(item_type)
        if not rows:
            await interaction.response.send_message(
                "The catalog is empty. Create items with /createitem.", ephemeral=True
            )
            return
        embed = discord.Embed(title="Cosmetic Item Catalog", color=discord.Color.blurple())
        for slug, itype, name, description, category, season, rarity in rows[:25]:
            bits = [_TYPE_LABEL.get(itype, itype), rarity]
            if category:
                bits.append(category)
            if season:
                bits.append(season)
            value = " · ".join(bits)
            if description:
                value += f"\n{description}"
            embed.add_field(name=f"{name} (`{slug}`)", value=value, inline=False)
        if len(rows) > 25:
            embed.set_footer(text=f"Showing 25 of {len(rows)} items.")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(
        name="checkinventory", description="See a player's cosmetic items. Admin only."
    )
    async def check_inventory(self, interaction: discord.Interaction, player_name: str):
        if not _is_admin(interaction):
            await _deny(interaction)
            return
        rows = await get_inventory(player_name.strip())
        coins = await get_coins(player_name.strip())
        if not rows:
            balance = f" (balance: {coins} HL Coins)" if coins is not None else ""
            await interaction.response.send_message(
                f"**{player_name}** owns no cosmetic items{balance}.", ephemeral=True
            )
            return
        embed = discord.Embed(
            title=f"Inventory — {player_name}", color=discord.Color.gold()
        )
        if coins is not None:
            embed.description = f"🪙 **{coins}** HL Coins"
        for slug, itype, name, rarity, equipped, granted_by in rows[:25]:
            marker = " ✅ equipped" if equipped else ""
            embed.add_field(
                name=f"{name} (`{slug}`){marker}",
                value=f"{_TYPE_LABEL.get(itype, itype)} · {rarity} · from {granted_by or '—'}",
                inline=False,
            )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # --- autocompletes -------------------------------------------------------
    @give_item.autocomplete("player_name")
    @revoke_item_cmd.autocomplete("player_name")
    @check_inventory.autocomplete("player_name")
    async def _player_ac(self, interaction: discord.Interaction, current: str):
        return await player_name_choices(current)

    @give_item.autocomplete("item_slug")
    @revoke_item_cmd.autocomplete("item_slug")
    @delete_item_cmd.autocomplete("item_slug")
    async def _item_ac(self, interaction: discord.Interaction, current: str):
        return await item_slug_choices(current)

    @set_price_cmd.autocomplete("item_slug")
    async def _set_price_item_ac(self, interaction: discord.Interaction, current: str):
        # Only suggest items that aren't on the shop yet (price 0/NULL), since
        # /setprice is used to add them. Existing shop items can still be
        # re-priced by typing the slug manually.
        return await item_slug_choices_off_shop(current)


async def setup(bot: commands.Bot):
    await bot.add_cog(CosmeticsCog(bot))
