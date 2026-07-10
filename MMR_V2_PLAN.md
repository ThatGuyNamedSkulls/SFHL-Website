# MMR v2 Plan — individual expectations, mixed-skill lobbies, per-mode ladders

Follow-up to `ELO_BALANCE_PLAN.md` (implemented: mmr_rr dual track, MOV,
zero-sum relative bonus, pure-performance placements, opponent seed-shift).
This plan closes the remaining gap to a real Valorant-style system: **every
expectation becomes conditional on the individual player's skill relative to
the lobby**, and gamemodes become first-class (5v5 / 2v2 / 1v1, with 1v1 on
its own ladder).

Owner decisions (2026-07-10, via Q&A):
1. **Win/loss expectation E: individual** — your own MMR vs the enemy average.
2. **Performance expectation scaling: moderate** — a 400-MMR gap shifts the
   expected score by ~1.5×.
3. **Placement grading: normalized by lobby strength** (on top of the existing
   pure-performance rule — wins still never count).
4. **1v1: separate rating/ladder** — 1v1 games no longer touch the 5v5
   MMR/Elo; they get their own placements, rating, and rank.

---

## Where the current system is still skill-blind (re-analysis)

The `/rank` pipeline (cogs/ranking.py) pre-computes per-side sums and hands
every player on a team the **same** context:

1. **Win/loss term** — `team_and_opp_avg()` (cogs/ranking.py:336) computes E
   from *your teammates' average (excluding you)* vs the enemy average. A
   900-MMR player carried into a 1400-avg lobby gets E ≈ 0.5 like everyone
   else: winning pays them the same as their 1400 teammates and losing costs
   them the same. No compensation in either direction. (This also means the
   smurf convergence in mmr_rr only comes from the rr layer, not the MMR
   update itself.)
2. **Performance bonus** — `relative_perf_bonuses()` (core/elo.py:147)
   compares each score to the **raw team mean**. The 900 player is *expected*
   to be outscored by 1400 teammates, yet gets a negative bonus every game for
   exactly that. Backwards from the requirement.
3. **Placement grading** — raw score through the placement bands. A placement
   player dropped into strong lobbies grades low even when overperforming
   their level; the ±75 seed-shift only nudges the final Elo, not the band.
4. **Gamemodes** — `QUEUE_MODES = {5, 1}` (no 2v2), and 1v1 results write to
   the same `elo`/`mmr` as 5v5, polluting the team ladder with duel results.
5. **Balancer** — already MMR-aware (prefers `mmr`, soft placement MMR
   included) and team-size agnostic; needs only a tiebreak polish and the 2v2
   mode registration.

---

## Design

### 1. Individual win/loss expectation (`e_basis`)

```
eff_i   = player's effective skill (mmr preferred, else elo, else unranked_eff)
E_i     = 1 / (1 + 10^((opp_avg − basis_i) / divisor))

basis_i =
  "individual": eff_i                                  # chosen default
  "blend":      e_blend·eff_i + (1−e_blend)·team_avg   # team_avg INCLUDES self
  "team":       team_avg excluding self                # legacy behavior
```

- Config: `e_basis = "individual"` (valorant-style.toml; code default stays
  `"team"` so other profiles are untouched), `e_blend = 0.5`.
- Implementation: `team_and_opp_avg()` grows into `expectation_basis(side,
  eff_self)`; `team_expected_update()` is unchanged (it already takes the two
  averages — we just pass `basis_i` instead of the teammates' average).
- Effect: 900-MMR winning vs a 1400 lobby → E≈0.05 → gains ~K·0.95·MOV;
  losing costs ~K·0.05. A 1700 in a 1000 lobby is the mirror image. The
  mmr_rr visible layer then follows via convergence, unchanged.
- Zero-sum note: with mixed lobbies the K·(S−E) term is no longer *exactly*
  zero-sum (Valorant's isn't either). The backtest gains a drift readout per
  `e_basis` so we can see the cost; the `delta_cap` still bounds pathologies.

### 2. Skill-conditioned performance bonus (`perf_mode = "skill_share"`)

Replace "score vs raw team mean" with "score vs what *your* skill should
score in *this* lobby":

```
w_i          = 10^(eff_i / perf_share_divisor)          # within your team
expected_i   = team_total_score · w_i / Σ w             # your fair share
t_i          = clamp((score_i − expected_i) / max(expected_i·perf_spread_ratio, 1), −1, 1)
bonus_i      = t_i · perf_bonus_max, re-centered per team  ⇒  Σ per team = 0
```

- `perf_share_divisor` anchors (comment in TOML): **2270 = moderate** (400-MMR
  gap ⇒ 1.5× expectation — chosen), 1330 = strong (2×), 4130 = mild (1.25×).
- Stays zero-sum by construction (same re-centering as today), still yields 0
  in 1v1 (single-member team ⇒ expected = actual share).
- `perf_mode` becomes three-valued: `"expected"` (legacy bands) |
  `"relative"` (current team-mean) | `"skill_share"` (new default in
  valorant-style.toml). `perf_rank_cap` (no bonus at A3+) still applies.
- New pure function `skill_share_bonuses(members: [(eff, score)], e)` in
  core/elo.py next to `relative_perf_bonuses`.

### 3. Lobby-normalized placement grading (`placement.grade_mode`)

Placement stays **pure performance** (owner rule: wins never count). The
graded score becomes lobby-relative using the same share weights, with the
player's **soft MMR** (seeded 1000, updated every placement game) as their skill:

```
share_i      = w_i / Σ w_team           (w from perf_share_divisor, soft MMR)
norm_factor  = clamp((1/n) / share_i, norm_min, norm_max)   # >1 in stronger lobbies
graded_score = raw_score · norm_factor
```

- `grade_mode = "normalized"` (valorant preset) | `"raw"` (legacy, code
  default). `norm_min = 0.6`, `norm_max = 1.8` guard degenerate lobbies.
- `graded_score` is what accumulates into `placement_points` and hits the
  placement bands — scoring 30 in a 1400-avg lobby grades like ~41 in an
  even lobby (matches the Q&A preview).
- Because normalization now does the band-level compensation, the graduation
  **seed-shift is reduced to a fine-tuner: `opp_weight 0.25 → 0.10`** in the
  valorant preset (both mechanisms derive from lobby strength; keeping both at
  full strength would double-compensate). `placement_opp_sum` plumbing stays
  exactly as built.
- The soft-MMR update itself (Glicko-2 vs the opposing side) is unchanged.

### 4. Per-mode ladders: 1v1 separate, 2v2 supported

**Mode identity.** A match's mode is inferred from the lineup size at `/rank`
time (2 players ⇒ 1v1, 4 ⇒ 2v2, 10 ⇒ 5v5; anything else ⇒ default mode), with
an optional explicit `mode` param to override. New `match_history.mode TEXT`
column (`"5v5" | "2v2" | "1v1"`, NULL legacy rows = main ladder) so stats and
the website can filter per mode.

**Ladder mapping (config `[modes]`).** Which rating a mode writes:

```toml
[modes]
"1v1" = { ladder = "own", placement_games = 3 }   # separate 1v1 rating
"2v2" = { ladder = "main" }                        # shares the 5v5 ladder
"5v5" = { ladder = "main" }
```

2v2 stays on the main ladder by default (it's still team play; flip its
`ladder` to `"own"` later if the league wants).

**Storage.** The main ladder keeps living in the existing `players` columns —
zero disruption to roles, top-10, website, `/resetdb`, season archive. Own-
ladder modes get a new table:

```sql
CREATE TABLE IF NOT EXISTS mode_ratings (
  player_name  TEXT NOT NULL,
  mode         TEXT NOT NULL,           -- e.g. '1v1'
  elo          INTEGER NOT NULL DEFAULT 0,
  mmr          REAL DEFAULT NULL,
  rank         TEXT NOT NULL DEFAULT '[?] Unranked',
  peak_elo     INTEGER DEFAULT 0,
  matches_played INTEGER DEFAULT 0,
  matches_won  INTEGER DEFAULT 0,
  placement_points REAL DEFAULT 0,
  placement_games_played INTEGER DEFAULT 0,
  placement_done INTEGER DEFAULT 0,
  placement_opp_sum REAL DEFAULT 0,
  glicko_rd    REAL DEFAULT 350.0,
  glicko_vol   REAL DEFAULT 0.06,
  last_played  TEXT DEFAULT NULL,
  PRIMARY KEY (player_name, mode)
)
```

Same rank bands, same placement bands, same math — just a different row. The
row is created lazily on a player's first game in that mode (they run fresh
placements there, 3 games for 1v1 per the config above).

**`/rank` wiring.** One new branch point, not a rewrite: `_capture_state` /
`_restore_state_stmt` gain a `mode` argument (own-ladder modes snapshot the
`mode_ratings` row instead of the rating columns of `players`); the rating
UPDATE targets the right table; stats/coins/achievements stay on `players`
(they're account-wide). `undo_state` JSON gains `"mode"` so `/undolastmatch`
restores the right row — exactness preserved.

**What reads which ladder:**
- Discord roles, Top-10, website main leaderboard, `/resetdb` archive: main
  ladder only (unchanged).
- Queue balancer: uses the ladder of the *current* `/gamemode` (1v1 queue
  balances on 1v1 MMR; falls back to main-ladder MMR, then
  `unranked_effective_elo`, for a player's first 1v1 games).
- `/checkplayer` and the website profile: show the 1v1 line when the row
  exists (phase 2 for the site).
- History: old 1v1 games are already baked into the main ladder and can't be
  cleanly unwound — they stay; only NEW 1v1 games hit the 1v1 ladder.

**Gamemode registration.** `QUEUE_MODES = {5: "5v5", 2: "2v2", 1: "1v1"}`,
`/gamemode` gains the 2v2 choice, profile validation already enforces
`queue_size == team_size·2`. The balancer's brute force is size-agnostic
(verified for n=2 and n=4); add one polish: among splits with equal average
difference, prefer the one minimizing the best-player mismatch (tiebreak).

### 5. Balancer recheck (summary of findings)

Already correct: MMR-preferred effective skill (incl. soft placement MMR),
party blocks, any team size. Changes: the tiebreak above, use the mode's
ladder rating (section 4), and nothing else — balancing on averages is the
right objective for lobbies this small.

---

## Config summary (valorant-style.toml additions)

```toml
[elo]
e_basis = "individual"        # win/loss E from OWN mmr vs enemy avg ("team" = legacy)
e_blend = 0.5                 # only used when e_basis = "blend"
perf_mode = "skill_share"     # expected score conditioned on own skill vs lobby
perf_share_divisor = 2270     # 400-MMR gap => 1.5x expected score (1330=2x, 4130=1.25x)

[placement]
grade_mode = "normalized"     # placement score scaled by lobby-relative expectation
norm_min = 0.6                # clamps on the normalization factor
norm_max = 1.8
opp_weight = 0.10             # seed-shift reduced: normalization now does the heavy lifting

[modes]
"1v1" = { ladder = "own", placement_games = 3 }
"2v2" = { ladder = "main" }
"5v5" = { ladder = "main" }
```

Code defaults (`e_basis="team"`, `perf_mode` unchanged, `grade_mode="raw"`,
no `[modes]` ⇒ everything on main) reproduce today's behavior — the
counterstrike.toml profile is untouched.

---

## Implementation order

| Step | Scope | Files |
|------|-------|-------|
| 1. Config plumbing: `e_basis`/`e_blend`, `skill_share` + divisor, `grade_mode` + clamps, `[modes]` parsing + validation | bot | `core/game_profile.py`, both TOMLs |
| 2. Math: `skill_share_bonuses()`, expectation-basis helper, placement `norm_factor()` | bot | `core/elo.py` |
| 3. `/rank`: individual E, skill-share bonuses, normalized placement grading | bot | `cogs/ranking.py` |
| 4. Mode ladders: `mode_ratings` table, mode inference + `match_history.mode`, capture/restore/undo per mode, `/ranktie` same | bot | `core/schema.py`, `cogs/ranking.py` |
| 5. Modes UX: `QUEUE_MODES` + `/gamemode` 2v2, balancer ladder-awareness + tiebreak, `/checkplayer` 1v1 line | bot | `cogs/queue.py`, `core/game_profile.py`, `cogs/players_admin.py` |
| 6. Tests: individual-E direction/magnitude, skill-share zero-sum + 1v1 zero, normalization clamps, mode-ladder isolation (1v1 game moves ONLY mode_ratings), undo per mode, config-default regression | bot | `tests/test_mmr_v2.py`, extend `test_mmr_rr_integration.py` |
| 7. Backtest: add per-`e_basis` drift readout + skill-share replay | bot | `scripts/backtest_elo.py` |
| 8. Website (`main`): mode label on matches, 1v1 leaderboard tab, profile dual-rating card | website | `lib/db.ts`, players/matches routes, leaderboard page |
| 9. Flip valorant-style.toml to the new keys, restart bot | ops | — |

Steps 1–7 land dark (code defaults preserve current behavior); step 9 is the
switch. `/undolastmatch` stays exact throughout, including own-ladder modes.

## Open items / risks
- **Individual E drift**: not exactly zero-sum in lopsided lobbies — measured
  by the backtest before the flip; `delta_cap` bounds the worst case. Accepted
  (Valorant's system drifts too; ladder resets each season anyway).
- **`/ranktie` in own-ladder modes**: same mode inference applies (2 players =
  1v1 tie) — small added branch in step 4.
- **Website 1v1 tab** is the largest UI piece and is deliberately last; the
  bot-side ladder works (and is queryable) without it.
- **Legacy 1v1 games** remain in the main ladder's history (flagged only by
  team size in old rows, unreliable) — we do not attempt retroactive
  separation.
