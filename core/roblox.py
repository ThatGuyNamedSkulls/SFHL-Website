"""Roblox avatar/user-id helpers (used by /checkplayer and /profile).

Discord-free; uses ``core.db.connect`` for the small cache reads/writes so cogs
can import it directly.
"""

import logging
import os

import aiohttp

from core import db

logger = logging.getLogger(__name__)


async def get_roblox_user_id(username: str):
    """Return the Roblox user id for a username, caching it in the players row."""
    row = await db.fetchone(
        "SELECT roblox_user_id FROM players WHERE name = ?", (username,)
    )
    if row and row[0]:
        return row[0]

    async with aiohttp.ClientSession() as session:
        url = f"https://users.roblox.com/v1/users/search?keyword={username}&limit=10"
        async with session.get(url) as response:
            if response.status != 200:
                logger.error(f"Failed to fetch Roblox user ID for '{username}': {response.status}")
                return None
            data = await response.json()
            if not data.get("data"):
                return None
            roblox_id = data["data"][0]["id"]

    await db.execute(
        "UPDATE players SET roblox_user_id = ? WHERE name = ?", (roblox_id, username)
    )
    return roblox_id


async def get_roblox_avatar_url(user_id):
    """Return a full-body avatar thumbnail URL for a Roblox user id."""
    async with aiohttp.ClientSession() as session:
        url = (
            f"https://thumbnails.roblox.com/v1/users/avatar?userIds={user_id}"
            "&size=720x720&format=Png&isCircular=true"
        )
        async with session.get(url) as response:
            if response.status == 200:
                data = await response.json()
                if data["data"]:
                    return data["data"][0]["imageUrl"]
    return None


async def get_or_download_roblox_avatar(player_name: str, roblox_user_id: int):
    """Return a LOCAL path to the player's avatar headshot, downloading+caching it."""
    row = await db.fetchone(
        "SELECT roblox_avatar_image FROM players WHERE name = ?", (player_name,)
    )
    if row and row[0] and os.path.exists(row[0]):
        return row[0]

    async with aiohttp.ClientSession() as session:
        url = (
            f"https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={roblox_user_id}"
            "&size=180x180&format=Png&isCircular=true"
        )
        async with session.get(url) as response:
            if response.status != 200:
                logger.error(f"Failed to fetch avatar JSON for user {roblox_user_id}")
                return None
            data = await response.json()
            try:
                image_url = data["data"][0]["imageUrl"]
            except (KeyError, IndexError, TypeError):
                return None
        if not image_url:
            return None
        async with session.get(image_url) as img:
            if img.status != 200:
                logger.error(f"Failed to download Roblox avatar image: {image_url}")
                return None
            content = await img.read()

    os.makedirs("avatars", exist_ok=True)
    local_path = f"avatars/{roblox_user_id}.png"
    with open(local_path, "wb") as f:
        f.write(content)

    await db.execute(
        "UPDATE players SET roblox_avatar_image = ? WHERE name = ?", (local_path, player_name)
    )
    return local_path
