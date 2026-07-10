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
    # --- balance knobs (defaults preserve pre-2026-07 behavior) ---
    tie_mode: str = "flat"          # "flat" = legacy +10 ties; "expected" = S=0.5 model math
    mov_weight: float = 0.0         # margin-of-victory multiplier weight; 0 disables
    max_rounds: int = 15            # rounds needed to win (scales the MOV multiplier)
    perf_mode: str = "expected"     # "expected" = rank bands; "relative" = vs own team's mean
    perf_spread_ratio: float = 0.5  # relative mode: score spread treated as "fully over/under"
    delta_cap: float = 0.0          # clamp on the final per-match delta; 0 disables
    # --- mmr_rr (Valorant-style hidden MMR + visible RR) parameters ---
    rr_base: float = 20.0           # neutral visible gain/loss per game
    conv_weight: float = 0.1        # how strongly (mmr - elo) skews the visible delta
    rr_min: float = 10.0            # visible delta floor
    rr_max: float = 30.0            # visible delta ceiling
    rr_tie_cap: float = 6.0         # max visible movement on a tie (toward the MMR)
    perf_rank_cap: str | None = None  # rank name; perf bonus applies only BELOW it (mmr_rr)
    # --- mixed-skill lobby knobs (MMR v2; defaults preserve prior behavior) ---
    # Basis of a player's win/loss expectation E vs the enemy average:
    #   "team"       — teammates' average excluding self (legacy behavior)
    #   "individual" — the player's OWN skill (Valorant-like: a low-MMR player
    #                  winning in a high lobby is compensated, and vice versa)
    #   "blend"      — e_blend·own + (1−e_blend)·team average (incl. self)
    e_basis: str = "team"
    e_blend: float = 0.5
    # perf_mode "skill_share": expected score = skill-weighted share of the team
    # total, weight 10^(skill/perf_share_divisor). Anchors for a 400-MMR gap:
    # 2270 ⇒ 1.5× expectation (moderate), 1330 ⇒ 2× (strong), 4130 ⇒ 1.25× (mild).
    perf_share_divisor: float = 2270.0


@dataclass(frozen=True)
class PlacementConfig:
    """Placement-flow tuning ([placement] in the profile TOML).

    Grading is pure performance by league decision: rank = avg score through
    the placement bands, wins/losses never enter the grade. Opponent strength
    shifts the graduation seed (opp_weight/opp_cap), and a hidden soft MMR
    (Glicko-2 + perf bonus, seeded at unranked_effective_elo) can track skill
    during placements for balancing without touching the visible rank.
    """

    games: int = 3            # placement games before graduation
    opp_weight: float = 0.0   # graduation-seed shift per point of avg-opponent skill deviation
    opp_cap: float = 75.0     # clamp on that shift
    use_mmr: bool = False     # track the hidden placement MMR
    # Placement grading (still pure performance — wins never count):
    #   "raw"        — the raw score hits the placement bands (legacy)
    #   "normalized" — the score is scaled by the player's lobby-relative
    #                  expectation (soft MMR share), clamped to [norm_min, norm_max]
    grade_mode: str = "raw"
    norm_min: float = 0.6
    norm_max: float = 1.8


@dataclass(frozen=True)
class ModeConfig:
    """Per-gamemode settings ([modes] in the profile TOML).

    ``ladder`` decides which rating a mode's matches move: "main" (the
    players-table Elo/MMR everything else reads) or "own" (a separate row in
    the mode_ratings table — its own Elo, MMR, rank, and placements).
    """

    ladder: str = "main"
    placement_games: int | None = None  # override of placement.games for this mode


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
    placement: PlacementConfig = field(default_factory=PlacementConfig)
    # Per-gamemode ladder mapping, keyed by label ("5v5" / "2v2" / "1v1").
    # Modes absent from the map default to the main ladder.
    modes: dict = field(default_factory=dict)

    @property
    def all_rank_names(self) -> set[str]:
        """Every rank name including Unranked (used for Discord role sync)."""
        return {self.unranked_name} | {r.name for r in self.ranks}

    def mode_label_for_count(self, n_players: int) -> str:
        """The gamemode label a lineup size implies ("1v1" for 2 players, "2v2"
        for 4, "5v5" for 10). Odd/unknown sizes fall back to the profile's
        configured team size (staff sometimes rank partial lineups)."""
        if n_players >= 2 and n_players % 2 == 0 and (n_players // 2) in QUEUE_MODES:
            half = n_players // 2
            return f"{half}v{half}"
        return f"{self.team_size}v{self.team_size}"

    def mode_config(self, mode_label: str) -> ModeConfig:
        """This mode's ladder settings (defaults to the main ladder)."""
        return self.modes.get(mode_label, ModeConfig())

    def placement_games_for(self, mode_label: str) -> int:
        """Placement length for a mode (per-mode override or the global count)."""
        override = self.mode_config(mode_label).placement_games
        return override if override else self.placement.games


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
    if profile.elo.model not in ("performance", "team_expected", "glicko2", "mmr_rr"):
        raise ValueError(
            f"Unknown elo.model '{profile.elo.model}' in profile '{profile.name}' "
            "(expected 'performance', 'team_expected', 'glicko2', or 'mmr_rr')."
        )
    if profile.elo.tie_mode not in ("flat", "expected"):
        raise ValueError(
            f"Unknown elo.tie_mode '{profile.elo.tie_mode}' in profile '{profile.name}' "
            "(expected 'flat' or 'expected')."
        )
    if profile.elo.perf_mode not in ("expected", "relative", "skill_share"):
        raise ValueError(
            f"Unknown elo.perf_mode '{profile.elo.perf_mode}' in profile '{profile.name}' "
            "(expected 'expected', 'relative', or 'skill_share')."
        )
    if profile.elo.e_basis not in ("team", "individual", "blend"):
        raise ValueError(
            f"Unknown elo.e_basis '{profile.elo.e_basis}' in profile '{profile.name}' "
            "(expected 'team', 'individual', or 'blend')."
        )
    if not 0.0 <= profile.elo.e_blend <= 1.0:
        raise ValueError(f"elo.e_blend must be in [0, 1] in profile '{profile.name}'.")
    if profile.elo.perf_share_divisor <= 0:
        raise ValueError(f"elo.perf_share_divisor must be > 0 in profile '{profile.name}'.")
    if profile.elo.mov_weight < 0:
        raise ValueError(f"elo.mov_weight must be >= 0 in profile '{profile.name}'.")
    if profile.elo.max_rounds < 2:
        raise ValueError(f"elo.max_rounds must be >= 2 in profile '{profile.name}'.")
    if profile.placement.games < 1:
        raise ValueError(f"placement.games must be >= 1 in profile '{profile.name}'.")
    if profile.placement.grade_mode not in ("raw", "normalized"):
        raise ValueError(
            f"Unknown placement.grade_mode '{profile.placement.grade_mode}' in profile "
            f"'{profile.name}' (expected 'raw' or 'normalized')."
        )
    if not 0 < profile.placement.norm_min <= 1.0 <= profile.placement.norm_max:
        raise ValueError(
            f"placement.norm_min/norm_max must satisfy 0 < min <= 1 <= max in "
            f"profile '{profile.name}'."
        )
    for label, mc in profile.modes.items():
        if mc.ladder not in ("main", "own"):
            raise ValueError(
                f"modes.{label}.ladder must be 'main' or 'own' in profile '{profile.name}'."
            )
        if mc.placement_games is not None and mc.placement_games < 1:
            raise ValueError(
                f"modes.{label}.placement_games must be >= 1 in profile '{profile.name}'."
            )
    if profile.elo.perf_rank_cap is not None:
        if profile.elo.perf_rank_cap not in {r.name for r in profile.ranks}:
            raise ValueError(
                f"elo.perf_rank_cap '{profile.elo.perf_rank_cap}' is not a rank name "
                f"in profile '{profile.name}'."
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
        tie_mode=elo_raw.get("tie_mode", "flat"),
        mov_weight=elo_raw.get("mov_weight", 0.0),
        max_rounds=elo_raw.get("max_rounds", 15),
        perf_mode=elo_raw.get("perf_mode", "expected"),
        perf_spread_ratio=elo_raw.get("perf_spread_ratio", 0.5),
        delta_cap=elo_raw.get("delta_cap", 0.0),
        rr_base=elo_raw.get("rr_base", 20.0),
        conv_weight=elo_raw.get("conv_weight", 0.1),
        rr_min=elo_raw.get("rr_min", 10.0),
        rr_max=elo_raw.get("rr_max", 30.0),
        rr_tie_cap=elo_raw.get("rr_tie_cap", 6.0),
        perf_rank_cap=elo_raw.get("perf_rank_cap"),
        e_basis=elo_raw.get("e_basis", "team"),
        e_blend=elo_raw.get("e_blend", 0.5),
        perf_share_divisor=elo_raw.get("perf_share_divisor", 2270.0),
    )

    placement_raw = data.get("placement", {})
    placement = PlacementConfig(
        games=placement_raw.get("games", 3),
        opp_weight=placement_raw.get("opp_weight", 0.0),
        opp_cap=placement_raw.get("opp_cap", 75.0),
        use_mmr=placement_raw.get("use_mmr", False),
        grade_mode=placement_raw.get("grade_mode", "raw"),
        norm_min=placement_raw.get("norm_min", 0.6),
        norm_max=placement_raw.get("norm_max", 1.8),
    )

    modes = {
        label: ModeConfig(
            ladder=raw.get("ladder", "main"),
            placement_games=raw.get("placement_games"),
        )
        for label, raw in data.get("modes", {}).items()
    }

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
        placement=placement,
        modes=modes,
    )
    _validate(profile)
    return profile


# The active profile, loaded once at import time.
ACTIVE: GameProfile = load_profile(settings.ACTIVE_GAME_PROFILE)


# Queue formats selectable at runtime via /gamemode (team size -> label).
QUEUE_MODES: dict[int, str] = {5: "5v5", 2: "2v2", 1: "1v1"}


def set_team_size(team_size: int) -> None:
    """Switch the active profile's team/queue size at runtime (5v5 / 2v2 / 1v1).

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
