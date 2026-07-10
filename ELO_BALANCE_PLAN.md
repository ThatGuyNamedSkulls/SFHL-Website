# Elo Balance Plan — ranked matches, ties, and placements

Goal: make Elo changes fairer and drift-free across the three flows that award
rating — ranked wins/losses (`/rank`), ties (`/ranktie`), and placement
graduation — while keeping the game-profile philosophy (all tuning in
`config/games/*.toml`, no magic numbers in code) and full `/undolastmatch`
compatibility.

Active model today: `team_expected` (`delta = K·(S−E) + perf bonus`).

---

## What's unbalanced today

**Ranked matches** (`core/elo.py:calculate_new_elo_team`)
1. **Margin of victory is ignored.** A 15-14 overtime win pays exactly the same
   as a 15-0 stomp. The round score (`points` = "winners,losers") is already
   collected and stored (`round_score`) but never enters the math.
2. **The performance bonus leaks rating into/out of the pool.** The ±6 bonus
   compares each player's score to their *rank's* static `expected_min/max`
   band. Nothing forces the bonuses in a match to sum to zero, so the total
   pool drifts; and the bands are calibrated for 5v5 — in **1v1 mode** the same
   bands judge a 1v1 score against 5v5 expectations, so 1v1 bonuses are junk.
3. Bands need manual recalibration whenever the meta shifts (they're absolute
   point values).

**Ties** (`cogs/ranking.py:rank_tie`)
4. **Flat +10 to every ranked player, regardless of anything.** This is the
   single biggest imbalance: it ignores opponents (a tie against a much
   stronger team should *gain* you Elo; against a weaker team it should *cost*
   you), it ignores performance, and it **inflates the pool by +10 × players
   every tie** (a 10-player tie mints +100 Elo out of thin air).
5. `/ranktie` bypasses the model entirely — even with `glicko2` selected
   (which natively supports draws as score 0.5), ties are still flat +10.

**Placements** (`/rank` + `/ranktie` placement branches, `core/ranks.py`)
6. **Wins don't matter.** Graduation rank = `determine_rank(avg score of 3
   games)`. A player who goes 0-3 but farms score places identically to one who
   goes 3-0 with the same score.
7. **Opponent strength doesn't matter.** Three placement games against D-rank
   lobbies and three against S1 lobbies grade on the same score bands.
8. **Placement players distort team balancing.** The balancer and the expected
   score `E` treat every 0-Elo player as `unranked_effective_elo = 1000`, even
   when their first two placement games already show they're a 600 or a 1700.
9. Three games is a very small sample (accepted league choice, but worth making
   the count configurable).

---

## Design

All new knobs live in `[elo]` (and a new `[placement]` table) in the profile
TOML, parsed into `EloConfig`/`GameProfile` with **defaults that reproduce
today's behavior** — so other profiles (and the `performance` model) are
untouched until a profile opts in.

### A. Opponent-aware ties (fixes #4, #5)

Treat a tie as `S = 0.5` in the existing model instead of flat +10:

```
delta_i = K_i · (0.5 − E_i) + perf_bonus_i
```

- Underdogs gain (E < 0.5 ⇒ positive), favorites lose a little (E > 0.5 ⇒
  negative), and the K·(S−E) term is ~zero-sum across the lobby — no more
  minting +10 × N per tie.
- `glicko2` model: pass score `0.5` straight into `glicko2.update` (already
  supported by `core/glicko2.py`).
- **New `/ranktie` inputs** — computing `E` needs to know the two teams:
  - `teams`: comma list aligned with `player_names`, values `1`/`2`
    (e.g. `teams: 1,1,1,1,1,2,2,2,2,2`).
  - `scores`: optional per-player comma list (drives the perf bonus for ranked
    players and replaces the awkward `points_for_unranked` format for placement
    players; `points_for_unranked` stays accepted for backward compat).
- Config: `tie_mode = "expected"` (new default in counterstrike.toml) |
  `"flat"` (legacy +10; also the fallback used when `teams` is omitted, with a
  warning in the reply so staff learn the new form).
- History rows keep `result = "TIE"` and now also store each player's team in
  the row (see D3 so the website can render tie scoreboards).

### B. Ranked-match balance (fixes #1–#3)

**B1. Margin-of-victory multiplier** on the `K·(S−E)` term, symmetric for both
sides (so the term stays zero-sum):

```
margin   = winner_rounds − loser_rounds            # from the existing `points` input
mov_mult = 1 + mov_weight · (margin − 1) / (max_rounds − 1),  clamped to [1, 1 + mov_weight]
delta    = mov_mult · K · (S − E) + perf_bonus
```

With `mov_weight = 0.35`, `max_rounds = 15`: a 15-14 win is ×1.00 (unchanged),
15-8 is ×1.18, 15-0 is ×1.35. `mov_weight = 0` disables (default for profiles
that don't set it). Ties skip MOV (margin 0).

**B2. Zero-sum, self-calibrating performance bonus** (`perf_mode = "relative"`):

Replace "my score vs my rank's static band" with "my score vs my *team's* score
this match":

```
t_i      = clamp((score_i − team_mean) / max(team_mean · perf_spread_ratio, 1), −1, 1)
bonus_i  = t_i · perf_bonus_max − mean(t · perf_bonus_max over my team)   # re-centered ⇒ Σ per team = 0
```

- Zero-sum by construction (bonuses within each team sum to 0) → no pool drift.
- Self-calibrating: no dependence on `expected_min/max`, so no manual
  recalibration and it's automatically correct in **1v1** (single-player team ⇒
  bonus 0, which is right — in 1v1 your performance *is* the result).
- Config: `perf_mode = "relative"` (new default in counterstrike.toml) |
  `"expected"` (current behavior, stays the code default). New
  `perf_spread_ratio = 0.5`. The rank `expected_*` bands remain for
  `/checkperformance` display and the legacy `performance` model.

**B3. Safety clamp** on the final per-player delta: `delta_cap = 45`
(config; generous — only guards pathological K×MOV×bonus stacking).

### C. Placement overhaul (fixes #7–#9; per league decision, #6 is NOT a fix)

**League decision (owner comment, 2026-07-08): wins and losses do NOT count in
placements.** Placement grading stays pure performance: rank =
`determine_rank(avg score)` through the existing `placement_min/max` bands,
exactly as today — someone going 0-3 with high stats places above someone going
0-3 (or 3-0) with low stats. Opponent strength *does* count (C2). The earlier
"win bonus" idea is dropped.

**C1. Soft hidden MMR during placements** (`[placement] use_mmr = true`):

Every unranked player gets a hidden MMR seeded at `unranked_effective_elo`
(1000). Each placement game updates it with the **Glicko-2 formula** (the
opposing side's players are the opponents, using the game's real outcome —
MMR is a skill estimate, so W/L legitimately moves it) **plus the relative
performance bonus from B2** layered on top. It does not affect the visible
rank — the player stays Unranked until all placement games are done — but it:
- makes team balancing and expected-score math honest mid-placement (a player
  tracking at 1700 stops being balanced as a flat 1000) — this replaces the
  band-interpolation "provisional Elo" idea, and
- becomes the player's hidden-track seed if the `mmr_rr` model is active.

Stored in a new `players.mmr REAL` column (+ the existing `glicko_rd`/
`glicko_vol` columns for the RD state); added to `_SNAPSHOT_COLS` so
`/undolastmatch` restores it exactly.

**C2. Opponent-strength adjustment at graduation:**

```
starting_elo = placement_elo(band) + clamp(opp_weight · (avg_opp_elo − unranked_effective_elo),
                                           −opp_cap, +opp_cap)
```

`opp_weight = 0.25`, `opp_cap = 75` (config). Placing against ~1400 lobbies
seeds you up to +75 higher than placing against ~700 lobbies. Requires
accumulating each placement game's average-opponent-Elo:
- New column `players.placement_opp_sum REAL DEFAULT 0` (via `_safe_alter` in
  `core/schema.py`), reset to 0 on graduation alongside `placement_points`.
- Added to `_SNAPSHOT_COLS` in `cogs/ranking.py` so `/undolastmatch` restores
  it exactly (snapshot machinery needs no other change).
- The opponent average comes from the same per-side sums `/rank` already
  computes for the `team_expected` pre-pass (using each opponent's effective
  skill — placement MMR included, see C1).

**C3. Configurable placement length:** `games = 3` in `[placement]`; replace
the hardcoded `== 3` / `/3` in `cogs/ranking.py` (both `/rank` and `/ranktie`
branches), `/viewparty`, `/checkplayer`, and thread the count through the
website's placement progress display (`app/api/players*` already returns
`placementGamesPlayed`; add `placementGamesTotal`). Staying at 3 vs moving to 5
is a league decision — the code stops caring.

(The placement→rank cap already exists implicitly: the top placement band
graduates into S1 max. Kept.)

### E. Valorant-style preset (`mmr_rr` model)

Valorant's ranked system is a **two-track** design, and everything in A–C maps
onto it — this section adds the one missing piece (the visible-rating layer) so
a profile can replicate it closely.

How Valorant works, mapped to our system:

| Valorant | Ours |
|---|---|
| Hidden MMR (true skill estimate, opponent-aware) | New hidden `players.mmr` column, updated by the existing `team_expected` (or `glicko2`) math from A–B |
| Visible RR, 0–100 per division, promote/demote at the edges | Visible `players.elo` — our rank bands ARE the divisions (D → ★), Elo-within-band is the RR bar |
| RR gains ~10–30, skewed by MMR-vs-rank **convergence** (MMR above your rank ⇒ bigger wins, smaller losses) | `rr_delta` formula below |
| Performance affects gains only at lower ranks (below ~Diamond); Immortal+ is pure W/L | `perf_rank_cap` config: the B2 relative bonus applies only while the player's rank index < cap |
| Decisive wins matter somewhat | B1 MOV multiplier (applied to the MMR update) |
| Draws move you slightly toward your MMR (±0–6 RR) | Tie: `rr_delta = clamp(conv_weight·(mmr−elo), −rr_tie_cap, +rr_tie_cap)`; hidden MMR still updates via A (S=0.5) |
| 5 placements, capped max rank, seeded by performance + opponent strength | C1–C4 as designed (`games = 5`, top placement band already caps at S1); placements set `mmr = elo` at graduation |
| Act reset re-seeding from MMR | `/resetdb` analog: optionally seed next season's placement expectation from `mmr` instead of zeroing it (kept — MMR survives the visible reset) |
| Demotion protection | Optional `demotion_floor = true`: a loss can't drop `elo` below the band floor until a second consecutive loss inside the shield |

**The visible-rating update** (`model = "mmr_rr"`):

```
# 1) hidden MMR update — exactly the A/B math (K·(S−E)·mov + perf bonus):
mmr' = mmr + delta_mmr

# 2) visible Elo (RR) update — fixed base gain, skewed toward the MMR:
win:  rr = clamp(rr_base + conv_weight·(mmr' − elo), rr_min, rr_max)      # elo += rr
loss: rr = clamp(rr_base − conv_weight·(mmr' − elo), rr_min, rr_max)      # elo −= rr
tie:  elo += clamp(conv_weight·(mmr' − elo), −rr_tie_cap, +rr_tie_cap)
```

With `rr_base = 20`, `conv_weight = 0.1`, `rr_min = 10`, `rr_max = 30`,
`rr_tie_cap = 6`: a player whose hidden MMR sits 100 above their visible Elo
gains 30/loses 10 until the two converge — Valorant's signature "you're
climbing because your MMR outranks your rank" feel — while a player at
equilibrium gains/loses ~20. The visible ladder can't inflate: it's anchored to
the (zero-sum, A/B-balanced) hidden MMR.

Implementation notes:
- `players.mmr REAL` via `_safe_alter` (backfill: `mmr = elo` where 0/NULL);
  added to `_SNAPSHOT_COLS` so `/undolastmatch` stays exact.
- `cogs/ranking.py`: in the `mmr_rr` branch, run the A/B math against `mmr`,
  then apply the rr formula to `elo`; rank/roles/website all keep reading `elo`
  (zero website changes needed for the core loop).
- Balancer + expected score `E` use `mmr` when present (it's the better skill
  estimate), falling back to `elo`.
- The results embed's breakdown line shows both: `MMR 1482→1497 · RR +26`.
- Config (all in `[elo]`): `rr_base`, `conv_weight`, `rr_min`, `rr_max`,
  `rr_tie_cap`, `perf_rank_cap` (rank name, e.g. `"[A3 | 1450-1649]"`),
  `demotion_floor`.
- Ships as a **preset profile** `config/games/valorant-style.toml`
  (`model = "mmr_rr"`, `placement.games = 5`, the values above) — flipping
  `ACTIVE_GAME_PROFILE` (or setting `model = "mmr_rr"` in counterstrike.toml)
  turns it on. The SFHL profile can keep plain `team_expected` if the league
  prefers one visible number with no hidden track.

What we deliberately *don't* replicate: per-agent/role adjustments, 5-stack RR
penalties, and duo-queue rank restrictions (queue policy, not rating math);
Valorant's exact constants are unpublished, so the preset targets its observed
behavior (gain ranges, convergence, placement caps), not its internals.

### D. Infrastructure, verification, website

**D1. Config plumbing** — `core/game_profile.py`: extend `EloConfig` with
`tie_mode="flat"`, `mov_weight=0.0`, `max_rounds=15`, `perf_mode="expected"`,
`perf_spread_ratio=0.5`, `delta_cap=45`; new frozen `PlacementConfig`
(`games=3`, `win_bonus=0.0`, `opp_weight=0.0`, `opp_cap=75`,
`provisional=False`) parsed from a `[placement]` TOML table. **Code defaults =
current behavior**; `counterstrike.toml` opts into the new values
(`tie_mode="expected"`, `mov_weight=0.35`, `perf_mode="relative"`,
`win_bonus=8`, `opp_weight=0.25`, `provisional=true`). Validate in
`_validate()` (e.g. `mov_weight >= 0`, `tie_mode` ∈ {flat, expected}).

**D2. Tests** (`tests/test_elo_balance.py`):
- Zero-sum invariants: synthetic 5v5 with equal K ⇒ Σ deltas ≈ 0 (win/loss and
  tie); relative perf bonuses sum to 0 per team.
- Tie direction: underdog team gains, favorite loses; equal teams ⇒ ~0.
- MOV: monotonic in margin; 15-14 ⇒ ×1.0; symmetric across the two teams.
- Placement: effective-points centering (50% winrate ⇒ pure score); graduation
  opp-adjustment sign + clamps; provisional-Elo interpolation endpoints
  (avg 0 ⇒ band floor 650-ish, avg 61+ ⇒ 1750).
- `mmr_rr`: convergence direction (MMR above Elo ⇒ win gain > loss magnitude,
  and vice versa); rr clamps respected; tie moves toward MMR within
  `rr_tie_cap`; equilibrium (mmr == elo) ⇒ symmetric ±`rr_base`; perf bonus
  applied only below `perf_rank_cap`.
- Undo roundtrip including the new `placement_opp_sum` and `mmr` snapshot
  columns (extend `tests/test_undo.py`).
- Config-default test: a profile TOML *without* the new keys produces deltas
  identical to today's math (regression guard for other games).

**D3. Backtest before enabling** — `scripts/backtest_elo.py`: replay
`matches.log` (full per-match JSON history already on disk) through old vs new
math and print per-match delta distributions and net pool drift (Σ deltas per
match). Acceptance: net drift per ranked match ≈ 0 (today it's nonzero via the
perf bonus, and ties are +10·N); no player's per-match |delta| exceeds
`delta_cap`. Tune `mov_weight`/`win_bonus` from this output before flipping the
TOML.

**D4. Website tie rendering** (`main` branch) — `app/api/matches/[matchId]/route.ts`
currently splits teams by `result === "W"/"L"`, so a TIE match renders two
empty teams. With teams now stored on tie rows (A), split by team number when
`result === "TIE"`, label them "Team 1 / Team 2" with `winner: null`, and show
the ± Elo. Also surface `placementGamesTotal` (C4).

**D5. Docs** — update `/rank` + `/ranktie` command descriptions, the `[elo]`
comments in `counterstrike.toml`, and `hand-off.md`.

---

## Decision points (defaults chosen; override before implementation)

1. **Tie entry UX:** extend `/ranktie` with `teams` + `scores` params
   *(chosen)* vs folding ties into `/rank`. Omitting `teams` falls back to
   legacy flat +10 with a nudge in the reply.
2. **`mov_weight = 0.35`** — max +35% for a 15-0; 0 disables.
3. **`win_bonus = 8`**, centered — and placements stay at **3 games** (the
   count just becomes config).
4. **Keep `tie_mode = "flat"` available** as a config escape hatch.
5. **Which model the SFHL ladder runs:** stay on upgraded `team_expected`
   (one visible number, simplest to explain) *(chosen as default)*, or switch
   to the Valorant-style `mmr_rr` preset (hidden MMR + visible RR with
   convergence). Both are built either way — it's a one-line TOML flip, and
   the backtest (D3) runs both so you can compare before deciding.

## Implementation order

| Step | Scope | Files (main ones) |
|------|-------|-------------------|
| 1. D1 config plumbing + defaults | bot | `core/game_profile.py`, `config/games/counterstrike.toml` |
| 2. A ties (S=0.5, `/ranktie` params, glicko2 wiring) | bot | `core/elo.py`, `cogs/ranking.py` |
| 3. B MOV + relative perf bonus + clamp | bot | `core/elo.py`, `cogs/ranking.py` |
| 4. C placements (win blend, opp adj + schema col, provisional, games count) | bot | `core/ranks.py`, `core/schema.py`, `cogs/ranking.py`, `cogs/queue.py`, `cogs/players_admin.py` |
| 5. E `mmr_rr` model + `players.mmr` column + valorant-style preset profile | bot | `core/elo.py`, `core/schema.py`, `cogs/ranking.py`, `config/games/valorant-style.toml` |
| 6. D2 tests + D3 backtest (both models), tune numbers | bot | `tests/`, `scripts/backtest_elo.py` |
| 7. Flip the TOML to the chosen model/defaults, restart bot | ops | — |
| 8. D4 website tie scoreboard + placement total | website (`main`) | `app/api/matches/[matchId]/route.ts`, players routes |

Steps 1–5 are safe to land dark (code defaults keep current behavior); step 6
is the actual switch, reversible by reverting the TOML. `/undolastmatch`
remains exact throughout because every mutation still flows through the
snapshot + atomic-batch machinery.
