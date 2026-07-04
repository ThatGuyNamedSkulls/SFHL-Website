"""Discord command cogs.

Each cog groups a domain of slash commands (moderation, ranking, queue, etc.).
Cogs are loaded by the bot's ``setup_hook`` (see main.py / EXTENSIONS).
"""

# Extensions loaded on startup. Add new cog modules here as commands are
# migrated out of main.py.
EXTENSIONS = [
    "cogs.moderation",
    "cogs.progression",
    "cogs.admin",
    "cogs.players_admin",
    "cogs.ranking",
    "cogs.matchflow",
    "cogs.queue",
    "cogs.profile",
    "cogs.social",
    "cogs.cosmetics",
]
