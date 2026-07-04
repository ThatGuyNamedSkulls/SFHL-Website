"""Shared in-memory state for the queue/party system.

Lives in its own module (rather than inside the queue cog) because the matchflow
cog's /vote_tie also needs ``queue_players``/``queue_channels`` to find the
eligible voters for a game channel. Both cogs import these same objects, so
mutating them in place keeps the state shared.
"""

from core.game_profile import ACTIVE as GAME

# {leader_id: {"members": [member_ids]}}
parties: dict = {}

# Website parties, mirrored from the Turso `web_parties` table by the queue
# cog's poll loop: {discord_user_id: [all member ids in that user's web party]}.
# Lets the (synchronous) queue embed group web-party members with 👥 without
# hitting the DB. Always mutated in place so importers keep the same object.
web_party_members: dict = {}

# List of queues, each a list of member objects.
queues: list = []

# {queue_index: text_channel}
queue_channels: dict = {}

# {channel.id: [player member objects]}
queue_players: dict = {}


def get_current_queue():
    """Return the active queue, starting a new one when the last is full.

    Uses ``>=`` (not ``==``) so a queue that somehow overfilled past the size
    still rolls over instead of being treated as "not yet full" forever.
    """
    if not queues or len(queues[-1]) >= GAME.queue_size:
        queues.append([])
    return queues[-1]
