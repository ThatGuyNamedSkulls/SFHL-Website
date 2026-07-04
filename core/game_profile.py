"""Loads and validates a game profile (config/games/*.toml).

A profile describes everything game-specific: stat columns, map pool, side
names, win condition, Elo bounds, and the rank table. The rest of the code reads
the active profile instead of hardcoded constants, which is what lets the bot
support games other than Counter-Strike.
"""

import tomllib
from dataclasses import dataclass, field

from config import settings


@dataclass(frozen=True)
class Rank:
    name: str
    elo_min: int
    elo_max: int
    # Per-match expected points (drives over/under-performance Elo scaling).
    expected_min: float | None = None
    expected_max: float | None = None
    # Placement graduation band + starting Elo (only placement-reachable ranks).
    placement_min: float | None = None
    placement_max: float | None = None
    placement_elo: int | None = None
    # Assumed per-player points for a ranked player in a tie (/ranktie). Falls back
    # to the expected-range midpoint when unset.
    tie_points: float | None = None


@dataclass(frozen=True)
class EloConfig:
    base: float
    win_min: float
    win_max: float
    loss_min: float
    loss_max: float
    overperform_ratio: float
    underperform_ratio: float
    unranked_effective_elo: int
    # Elo model: "performance" (original: each player's own points vs their rank's
    # expected range) or "team_expected" (opponent-aware: expected score from the
    # team Elo difference + dynamic K-factor + a small performance bonus).
    model: str = "performance"
    # --- team_expected parameters ---
    divisor: float = 400.0          # standard Elo logistic divisor
    perf_bonus_max: float = 6.0     # ± cap for the layered performance bonus
    k_new: float = 40.0             # K while matches_played < k_new_games
    k_new_games: int = 30
    k_mid: float = 24.0             # K for everyone else
    k_top: float = 10.0             # K once current Elo >= k_top_elo
    k_top_elo: int = 2200
    # --- glicko2 parameters ---
    tau: float = 0.5                # Glicko-2 system constant (volatility constraint)


@dataclass(frozen=True)
class GameProfile:
    name: str
    team_size: int
    queue_size: int
    win_label: str
    loss_label: str
    win_condition: str
    stats: list[str]
    maps: list[str]
    sides: list[str]
    elo: EloConfig
    unranked_name: str
    ranks: list[Rank] = field(default_factory=list)

    @property
    def all_rank_names(self) -> set[str]:
        """Every rank name including Unranked (used for Discord role sync)."""
        return {self.unranked_name} | {r.name for r in self.ranks}


def _validate(profile: "GameProfile") -> None:
    """Sanity-check internal consistency so bad configs fail loudly at load."""
    if profile.queue_size != profile.team_size * 2:
        raise ValueError(
            f"queue_size ({profile.queue_size}) must equal team_size*2 "
            f"({profile.team_size * 2}) in profile '{profile.name}'."
        )
    supported = {"kills", "deaths", "assists", "mvps", "score", "hs_percent"}
    unknown = set(profile.stats) - supported
    if unknown:
        raise ValueError(f"Unknown stat keys in profile '{profile.name}': {unknown}")
    if profile.elo.model not in ("performance", "team_expected", "glicko2"):
        raise ValueError(
            f"Unknown elo.model '{profile.elo.model}' in profile '{profile.name}' "
            "(expected 'performance', 'team_expected', or 'glicko2')."
        )
    # Elo bands must be ascending and non-overlapping.
    last_max = -1
    for r in profile.ranks:
        if r.elo_min <= last_max:
            raise ValueError(
                f"Rank '{r.name}' Elo band overlaps the previous rank in "
                f"profile '{profile.name}'."
            )
        last_max = r.elo_max


def load_profile(path: str) -> GameProfile:
    """Parse a profile TOML file into a validated :class:`GameProfile`."""
    with open(path, "rb") as f:
        data = tomllib.load(f)

    elo_raw = data["elo"]
    elo = EloConfig(
        base=elo_raw["base"],
        win_min=elo_raw["win_min"],
        win_max=elo_raw["win_max"],
        loss_min=elo_raw["loss_min"],
        loss_max=elo_raw["loss_max"],
        overperform_ratio=elo_raw["overperform_ratio"],
        underperform_ratio=elo_raw["underperform_ratio"],
        unranked_effective_elo=elo_raw["unranked_effective_elo"],
        model=elo_raw.get("model", "performance"),
        divisor=elo_raw.get("divisor", 400.0),
        perf_bonus_max=elo_raw.get("perf_bonus_max", 6.0),
        k_new=elo_raw.get("k_new", 40.0),
        k_new_games=elo_raw.get("k_new_games", 30),
        k_mid=elo_raw.get("k_mid", 24.0),
        k_top=elo_raw.get("k_top", 10.0),
        k_top_elo=elo_raw.get("k_top_elo", 2200),
        tau=elo_raw.get("tau", 0.5),
    )

    ranks = [
        Rank(
            name=r["name"],
            elo_min=r["elo_min"],
            elo_max=r["elo_max"],
            expected_min=r.get("expected_min"),
            expected_max=r.get("expected_max"),
            placement_min=r.get("placement_min"),
            placement_max=r.get("placement_max"),
            placement_elo=r.get("placement_elo"),
            tie_points=r.get("tie_points"),
        )
        for r in data["ranks"]
    ]

    profile = GameProfile(
        name=data["meta"]["name"],
        team_size=data["meta"]["team_size"],
        queue_size=data["meta"]["queue_size"],
        win_label=data["match"]["win_label"],
        loss_label=data["match"]["loss_label"],
        win_condition=data["match"]["win_condition"],
        stats=list(data["scoreboard"]["stats"]),
        maps=list(data["maps"]["pool"]),
        sides=list(data["maps"].get("sides", [])),
        elo=elo,
        unranked_name=data["unranked"]["name"],
        ranks=ranks,
    )
    _validate(profile)
    return profile


# The active profile, loaded once at import time.
ACTIVE: GameProfile = load_profile(settings.ACTIVE_GAME_PROFILE)


# Queue formats selectable at runtime via /gamemode (team size -> label).
QUEUE_MODES: dict[int, str] = {5: "5v5", 1: "1v1"}


def set_team_size(team_size: int) -> None:
    """Switch the active profile's team/queue size at runtime (5v5 <-> 1v1).

    ``ACTIVE`` is a frozen dataclass shared by every importer, so the swap uses
    ``object.__setattr__`` — every call-time read of ``GAME.team_size`` /
    ``GAME.queue_size`` (queue fill checks, embeds, team splits) picks the new
    values up immediately. Keeps the queue_size == team_size*2 invariant.
    """
    if team_size not in QUEUE_MODES:
        raise ValueError(
            f"Unsupported team size {team_size} (expected one of {sorted(QUEUE_MODES)})"
        )
    object.__setattr__(ACTIVE, "team_size", team_size)
    object.__setattr__(ACTIVE, "queue_size", team_size * 2)
