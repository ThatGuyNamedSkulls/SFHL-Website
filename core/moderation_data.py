"""Pure DB/logic helpers for moderation (warnings + leaving incidents).

Discord-free so they can be shared by both main.py (the timeout flow) and the
moderation cog without a circular import, and unit-tested in isolation. Uses
``core.db.connect`` (one connection per call) instead of the old global cursor.
"""

from datetime import datetime, timedelta, timezone

from core import db

# ELO penalty escalation for leaving mid-game (resets after 3 days).
LEAVING_PENALTY_MAP = {1: 10, 2: 15, 3: 18, 4: 22, 5: 25, 6: 30, 7: 35}
LEAVING_PENALTY_MAX = 40
LEAVING_WINDOW_DAYS = 3


def leaving_window_cutoff() -> str:
    """The rolling-window cutoff as a TEXT timestamp string.

    `leaving_incidents.timestamp` is `DATETIME DEFAULT CURRENT_TIMESTAMP`, which
    SQLite stores as the TEXT "YYYY-MM-DD HH:MM:SS" in UTC. Comparisons must be
    against a TEXT value in the same format: a Python ``datetime`` param is
    serialized by libsql to an integer (epoch ms), and INTEGER always sorts
    below TEXT in SQLite, so datetime comparisons here silently match nothing /
    everything. Formatting to the CURRENT_TIMESTAMP string fixes both the type
    mismatch and the previous local-vs-UTC timezone bug.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=LEAVING_WINDOW_DAYS)
    return cutoff.strftime("%Y-%m-%d %H:%M:%S")


async def get_or_create_warning_count(user_id: int, user_name: str) -> int:
    """Increment (or create) and return a user's warning count."""
    row = await db.fetchone(
        "SELECT warning_count FROM warnings WHERE user_id = ?", (user_id,)
    )
    if row:
        new_count = row[0] + 1
        await db.execute(
            "UPDATE warnings SET warning_count = ?, user_name = ?, "
            "last_updated = CURRENT_TIMESTAMP WHERE user_id = ?",
            (new_count, user_name, user_id),
        )
    else:
        new_count = 1
        await db.execute(
            "INSERT INTO warnings (user_id, user_name, warning_count) VALUES (?, ?, ?)",
            (user_id, user_name, new_count),
        )
    return new_count


async def cleanup_old_leaving_incidents(user_id: int) -> None:
    """Remove leaving incidents older than the rolling window for a user."""
    await db.execute(
        "DELETE FROM leaving_incidents WHERE user_id = ? AND timestamp < ?",
        (user_id, leaving_window_cutoff()),
    )


async def get_leaving_incident_count(user_id: int) -> int:
    """Count a user's leaving incidents within the rolling window."""
    await cleanup_old_leaving_incidents(user_id)
    row = await db.fetchone(
        "SELECT COUNT(*) FROM leaving_incidents WHERE user_id = ? AND timestamp >= ?",
        (user_id, leaving_window_cutoff()),
    )
    return row[0] if row else 0


def calculate_leaving_elo_penalty(incident_count: int) -> int:
    """ELO penalty for the Nth leaving incident."""
    return LEAVING_PENALTY_MAP.get(incident_count, LEAVING_PENALTY_MAX)
