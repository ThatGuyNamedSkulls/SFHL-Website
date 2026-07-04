"""Achievement progress tracking (shared by /rank and the progression cog).

Discord-free so both main.py and cogs can import it without a circular
dependency. Uses ``core.db.connect`` instead of ad-hoc sqlite connections.
"""

from core import db

ACHIEVEMENT_EMOJIS = {
    "Bronze": "🥉",
    "Silver": "🥈",
    "Gold": "🥇",
    "Diamond": "💎",
    "Master": "🏆",
}

ACHIEVEMENT_THRESHOLDS = {
    "Points Mastery": {"Bronze": 500, "Silver": 2000, "Gold": 5000, "Diamond": 10000, "Master": 25000},
    "Wins Mastery": {"Bronze": 10, "Silver": 50, "Gold": 100, "Diamond": 150, "Master": 200},
    "Matches Played Mastery": {"Bronze": 10, "Silver": 50, "Gold": 100, "Diamond": 150, "Master": 200},
    "Top Scorer Mastery": {"Bronze": 50, "Silver": 100, "Gold": 150, "Diamond": 175, "Master": 200},
}


async def update_achievement_progress(player_name, achievement_name, progress_increment):
    """Add progress to an achievement, promoting its level when thresholds are met."""
    row = await db.fetchone(
        "SELECT progress, max_progress, level FROM achievements "
        "WHERE player_name = ? AND achievement_name = ?",
        (player_name, achievement_name),
    )

    if row:
        current_progress, max_progress, current_level = row
        new_progress = min(current_progress + progress_increment, max_progress)
        new_level = current_level
        for level, threshold in ACHIEVEMENT_THRESHOLDS[achievement_name].items():
            if new_progress >= threshold:
                new_level = level
        await db.execute(
            "UPDATE achievements SET progress = ?, level = ? "
            "WHERE player_name = ? AND achievement_name = ?",
            (new_progress, new_level, player_name, achievement_name),
        )
    else:
        max_progress = max(ACHIEVEMENT_THRESHOLDS[achievement_name].values())
        await db.execute(
            "INSERT INTO achievements (player_name, achievement_name, progress, max_progress, level) "
            "VALUES (?, ?, ?, ?, ?)",
            (player_name, achievement_name, progress_increment, max_progress, "Bronze"),
        )


def _level_for_progress(achievement_name, progress):
    """Highest level whose threshold the progress meets (defaults to Bronze)."""
    level = "Bronze"
    for lvl, threshold in ACHIEVEMENT_THRESHOLDS[achievement_name].items():
        if progress >= threshold:
            level = lvl
    return level


async def revert_achievement_progress(player_name, achievement_name, decrement):
    """Subtract progress (for /undolastmatch) and recompute the level. Clamps at 0."""
    if decrement <= 0:
        return
    row = await db.fetchone(
        "SELECT progress FROM achievements WHERE player_name = ? AND achievement_name = ?",
        (player_name, achievement_name),
    )
    if not row:
        return
    new_progress = max(0, row[0] - decrement)
    await db.execute(
        "UPDATE achievements SET progress = ?, level = ? "
        "WHERE player_name = ? AND achievement_name = ?",
        (new_progress, _level_for_progress(achievement_name, new_progress),
         player_name, achievement_name),
    )


async def display_player_achievements(player_name):
    """Return a human-readable summary of a player's achievement progress."""
    achievements = await db.fetchall(
        "SELECT achievement_name, level, progress, max_progress FROM achievements "
        "WHERE player_name = ?",
        (player_name,),
    )

    if not achievements:
        return "No achievements found."

    lines = []
    for name, level, progress, max_progress in achievements:
        emoji = ACHIEVEMENT_EMOJIS.get(level, "")
        thresholds = ACHIEVEMENT_THRESHOLDS[name]
        levels = list(thresholds.keys())
        current_index = levels.index(level)
        if current_index + 1 < len(levels):
            next_threshold = thresholds[levels[current_index + 1]]
            lines.append(f"{emoji} {name}: {level} ({progress}/{next_threshold})")
        else:
            lines.append(f"{emoji} {name}: {level} ({progress}/{max_progress}) | Max Level Achieved")

    return "\n".join(lines)
