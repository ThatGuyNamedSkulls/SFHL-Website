"""Unified rank logic, derived entirely from the active game profile.

Replaces three overlapping sources of truth that used to live in ``main.py``:
  * ``RANK_THRESHOLDS``  (Elo band -> rank name)
  * ``PLACEMENT_RANKS``  (avg placement points -> rank)
  * ``rank_expectations`` (rank -> expected per-match points), which was
    copy-pasted verbatim into three different functions.

Everything now reads from one table (the profile's ``[[ranks]]``), so the bands
can never drift out of sync again.

For backward compatibility with the rest of ``main.py`` (which still iterates
``RANK_THRESHOLDS`` as ``(low, high, name)`` tuples), that name is re-exported
here in the same shape.
"""

from core.game_profile import ACTIVE, GameProfile


def _build_thresholds(profile: GameProfile):
    """(elo_min, elo_max, name) rows: Unranked first, then ranks low -> high."""
    rows = [(0, 0, profile.unranked_name)]
    for r in profile.ranks:
        rows.append((r.elo_min, r.elo_max, r.name))
    return rows


# Backward-compatible threshold list for code that iterates it as 3-tuples.
RANK_THRESHOLDS = _build_thresholds(ACTIVE)


def get_rank(elo: int, profile: GameProfile = ACTIVE) -> str:
    """Return the rank name for an Elo value (Unranked at 0).

    Mirrors the original: first matching band wins; if Elo exceeds all bands,
    fall back to the highest rank.
    """
    thresholds = RANK_THRESHOLDS if profile is ACTIVE else _build_thresholds(profile)
    for r_min, r_max, name in thresholds:
        if r_min <= elo <= r_max:
            return name
    return thresholds[-1][2]


def determine_rank(points_avg: float, profile: GameProfile = ACTIVE) -> str:
    """Map average placement-match points to a starting rank.

    Mirrors the original ``determine_rank``: rounds the average and finds the
    placement band it falls into.
    """
    round_points = round(points_avg)
    for r in profile.ranks:
        if r.placement_min is None or r.placement_max is None:
            continue
        if r.placement_min <= round_points <= r.placement_max:
            return r.name
    return profile.unranked_name


def get_expected_range(rank_name: str, profile: GameProfile = ACTIVE):
    """Return (expected_min, expected_max) per-match points for a rank.

    Falls back to (20, 40) for unknown ranks, matching the original defaults.
    """
    for r in profile.ranks:
        if r.name == rank_name and r.expected_min is not None:
            return (r.expected_min, r.expected_max)
    return (20, 40)


def get_tie_points(rank_name: str, profile: GameProfile = ACTIVE) -> int:
    """Assumed per-player points for a ranked player in a tie (/ranktie).

    Uses the rank's configured ``tie_points`` if present, else the expected-range
    midpoint, else 25.
    """
    for r in profile.ranks:
        if r.name == rank_name:
            if r.tie_points is not None:
                return int(r.tie_points)
            if r.expected_min is not None:
                return int((r.expected_min + r.expected_max) / 2)
    return 25


def get_placement_elo(rank_name: str, profile: GameProfile = ACTIVE) -> int:
    """Return the starting Elo when graduating into ``rank_name``.

    Defaults to 1000 (the original fallback) when not configured.
    """
    for r in profile.ranks:
        if r.name == rank_name and r.placement_elo is not None:
            return r.placement_elo
    return 1000
