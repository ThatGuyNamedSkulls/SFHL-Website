"""Backtest the Elo balance overhaul against the real match history.

Replays every match in matches.log (per-match JSON blocks written by /rank)
through the OLD math (flat team_expected, expected-band bonus, no MOV) and the
NEW math (MOV multiplier + zero-sum relative bonus + delta cap), plus the
mmr_rr visible-rating layer, and prints per-match delta distributions and net
pool drift so the knobs can be tuned before (or after) flipping the TOML.

The log lacks team-average context (only each player's previous_elo), so both
models are replayed with the same reconstruction: each side's average Elo from
its players' previous_elo values. That keeps the comparison apples-to-apples.

    python scripts/backtest_elo.py [path/to/matches.log]
"""

import json
import os
import statistics
import sys

# Force UTF-8 stdout so this prints cleanly even on Windows consoles whose
# default codepage (cp1252) can't encode characters used below.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import elo  # noqa: E402
from core.game_profile import load_profile  # noqa: E402

_GAMES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "games")
NEW = load_profile(os.path.join(_GAMES, "counterstrike.toml"))
VAL = load_profile(os.path.join(_GAMES, "valorant-style.toml"))


def parse_matches(path):
    """matches.log holds pretty-printed JSON objects back to back — split on
    the closing brace at column 0."""
    with open(path, encoding="utf-8", errors="replace") as f:
        raw = f.read()
    blocks, depth, start = [], 0, None
    for i, ch in enumerate(raw):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    blocks.append(json.loads(raw[start:i + 1]))
                except json.JSONDecodeError:
                    pass
                start = None
    return blocks


def replay(match, profile, mov_mult, bonus_mode):
    """Return per-player deltas for one match. bonus_mode: "none" | "band"
    (legacy expected-range bonus) | "relative" (new zero-sum bonus)."""
    details = [
        d for d in match.get("details", [])
        if "previous_elo" in d and "result" in d and d.get("result") in ("W", "L")
    ]
    if len(details) < 2:
        return None
    sides = {"W": [], "L": []}
    for d in details:
        sides[d["result"]].append(d)
    if not sides["W"] or not sides["L"]:
        return None

    def side_avg(side):
        return statistics.mean(
            p["previous_elo"] or profile.elo.unranked_effective_elo for p in sides[side]
        )

    avg = {"W": side_avg("W"), "L": side_avg("L")}

    bonus_of = {}
    if bonus_mode == "relative":
        for s, members in sides.items():
            scores = [m.get("points", 0) or 0 for m in members]
            for m, b in zip(members, elo.relative_perf_bonuses(scores, profile.elo)):
                bonus_of[id(m)] = b

    deltas = []
    for s, members in sides.items():
        opp = "L" if s == "W" else "W"
        for m in members:
            cur = m["previous_elo"] or profile.elo.unranked_effective_elo
            n = len(members)
            own_excl = ((avg[s] * n) - cur) / (n - 1) if n > 1 else cur
            # Expectation basis per the profile's e_basis (own / blend / team),
            # exactly as cogs/ranking.py computes it.
            basis = elo.expectation_basis(cur, avg[s], own_excl, profile.elo)
            new_elo, _bd = elo.team_expected_update(
                cur, 1.0 if s == "W" else 0.0, basis, avg[opp], 50, profile,
                mov_mult=mov_mult,
                perf_bonus=(0.0 if bonus_mode == "none" else bonus_of.get(id(m))),
                point=(m.get("points") if bonus_mode == "band" else None),
            )
            deltas.append(new_elo - cur)
    return deltas


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "matches.log"
    )
    matches = parse_matches(path)
    print(f"Parsed {len(matches)} matches from {path}\n")

    mid_mov = 1.0 + NEW.elo.mov_weight / 2 if NEW.elo.mov_weight else 1.0

    # Decomposed variants, isolating each new component's contribution:
    #   base      -> K*(S-E) alone, no MOV, no bonus (the irreducible baseline:
    #                dynamic K differs per player, so this is NEVER exactly
    #                zero-sum when the two sides have different average
    #                experience — true before AND after this work).
    #   +band     -> the OLD behavior (base + legacy expected-range bonus).
    #   +relative -> base + the NEW zero-sum relative bonus (no MOV yet).
    #   +mov      -> the full NEW math (relative bonus + MOV multiplier).
    variants = {
        "base       (K*(S-E) only, no bonus, no MOV)": (1.0, "none"),
        "+band      (OLD: legacy rank-band bonus)   ": (1.0, "band"),
        "+relative  (NEW bonus only, no MOV)        ": (1.0, "relative"),
        "+mov       (NEW: relative bonus + MOV)     ": (mid_mov, "relative"),
    }
    results = {label: ([], []) for label in variants}
    for match in matches:
        for label, (mov_mult, bonus_mode) in variants.items():
            d = replay(match, NEW, mov_mult=mov_mult, bonus_mode=bonus_mode)
            if d is None:
                continue
            all_deltas, drift = results[label]
            all_deltas += d
            drift.append(sum(d))

    def report(label, deltas, drift):
        if not deltas:
            print(f"{label}: no replayable matches")
            return
        print(
            f"{label}: n_matches={len(drift)}  mean|delta|={statistics.mean(map(abs, deltas)):.1f}  "
            f"min={min(deltas)}  max={max(deltas)}  "
            f"net pool drift/match={statistics.mean(drift):+.2f}"
        )

    for label, (deltas, drift) in results.items():
        report(label, deltas, drift)

    # --- MMR v2: e_basis comparison (win/loss expectation in mixed lobbies) ---
    # "individual" compensates a low-MMR player winning in a high lobby, but is
    # not exactly zero-sum in lopsided lobbies; this quantifies the cost.
    import dataclasses
    print()
    for basis in ("team", "individual", "blend"):
        prof = dataclasses.replace(NEW, elo=dataclasses.replace(NEW.elo, e_basis=basis))
        deltas, drift = [], []
        for match in matches:
            d = replay(match, prof, mov_mult=1.0, bonus_mode="none")
            if d is None:
                continue
            deltas += d
            drift.append(sum(d))
        if drift:
            print(
                f"e_basis={basis:<10}: mean|delta|={statistics.mean(map(abs, deltas)):.1f}  "
                f"min={min(deltas)}  max={max(deltas)}  "
                f"net pool drift/match={statistics.mean(drift):+.2f}"
            )

    base_drift = statistics.mean(results[list(variants)[0]][1]) if results[list(variants)[0]][1] else 0.0
    rel_drift = statistics.mean(results[list(variants)[2]][1]) if results[list(variants)[2]][1] else 0.0
    print(
        f"\nThe relative bonus is exactly zero-sum by construction (verify: "
        f"'+relative' drift {rel_drift:+.2f} matches 'base' drift {base_drift:+.2f} — "
        "any gap here would be a real bug, not just noise)."
    )
    print(
        "Residual drift in 'base' is the PRE-EXISTING dynamic-K asymmetry "
        "(k_new/k_mid/k_top differ by player experience) — present before this "
        "overhaul too, standard in any dynamic-K Elo system, and unrelated to "
        "the MOV/relative-bonus changes."
    )
    print(
        "\nTies under OLD math minted +10 x players per tie; under NEW math they are "
        "~zero-sum (not in this log's replay — /ranktie wrote no per-player blocks)."
    )
    print(f"mmr_rr preset loaded OK: rr_base={VAL.elo.rr_base}, conv={VAL.elo.conv_weight}")


if __name__ == "__main__":
    main()
