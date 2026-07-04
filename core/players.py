"""Player Elo data access, decoupled from Discord side effects.

The old ``update_player_elo`` in main.py mixed a DB write with scheduling a
Discord role refresh, which made it impossible to import from a cog without a
circular dependency on the bot. Here the DB write is pure; anything that wants
to react to an Elo change (e.g. the Top 10 role refresh) registers an observer
via :func:`register_elo_observer`. main.py registers that observer at startup.
"""

import logging
from typing import Callable, Optional

from core import db
from core.ranks import get_rank

logger = logging.getLogger(__name__)

# Callbacks invoked (name, new_elo, new_rank) after an Elo update.
_elo_observers: list[Callable[[str, int, str], None]] = []


def register_elo_observer(callback: Callable[[str, int, str], None]) -> None:
    _elo_observers.append(callback)


async def get_player_elo(player_name: str) -> Optional[int]:
    """Return the player's Elo, or None if they aren't in the DB."""
    row = await db.fetchone(
        "SELECT elo FROM players WHERE name = ?", (player_name,)
    )
    return row[0] if row else None


async def set_player_elo(player_name: str, new_elo: int) -> str:
    """Update a player's Elo + rank in the DB (no side effects). Returns the rank."""
    new_rank = get_rank(new_elo)
    await db.execute(
        "UPDATE players SET elo = ?, rank = ? WHERE name = ?",
        (new_elo, new_rank, player_name),
    )
    logger.info(
        f"Updated Elo and rank for player '{player_name}' to Elo: {new_elo}, Rank: {new_rank}."
    )
    return new_rank


async def update_player_elo(player_name: str, new_elo: int) -> str:
    """Update Elo, then notify observers (e.g. to refresh Top 10 roles)."""
    new_rank = await set_player_elo(player_name, new_elo)
    for callback in _elo_observers:
        try:
            callback(player_name, new_elo, new_rank)
        except Exception:
            logger.exception("Elo observer callback failed")
    return new_rank
