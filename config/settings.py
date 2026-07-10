"""Bot-wide settings and the selection of the active game profile.

Game-specific values (ranks, maps, Elo, stats) live in the game profile TOML,
not here. This file holds only deployment/runtime settings.
"""

import os

# Discord guild this bot serves.
GUILD_ID = 973987866336190484

# Role names used for permission checks and rank assignment.
MATCH_STAFF_ROLE = "[MS] Match Staff"
MM_MANAGER_ROLE = "MatchMaking Manager"  # higher privilege (season reset, etc.)
BLACKLIST_ROLE = "League blacklisted"
TOP10_ROLE_NAME = "[C] SFHL C | Top 10"
TOP10_MIN_ELO = 0
TOP10_COUNT = 10

# Which game profile is active. Point this at any file under config/games/.
# Running the Valorant-style dual-track ranked system (hidden MMR + visible RR
# with convergence, 5 placements graded on pure performance). Switch back to
# counterstrike.toml for the single-number team_expected ladder.
#
# Migration note (live DB): existing players keep their visible Elo/rank; their
# hidden `mmr` seeds from that Elo on their first ranked game (NULL -> current
# elo fallback in cogs/ranking.py), so no backfill is required. Requires a bot
# restart to pick up the schema/columns and the re-synced /ranktie signature.
_GAMES_DIR = os.path.join(os.path.dirname(__file__), "games")
ACTIVE_GAME_PROFILE = os.path.join(_GAMES_DIR, "valorant-style.toml")
