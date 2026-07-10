# SFHL Bot + HyperLeague Website — Bug & Improvement Report

Review date: 2026-07-08. Scope: the Discord bot (`main.py`, `cogs/`, `core/`,
`rendering/`) and the Next.js website (`HL website/hyperleague/`).

Overall the code is in good shape — parameterized SQL everywhere (no injection
found), atomic batches for multi-row writes, careful concurrency handling in the
party store, and thoughtful comments. The findings below are ranked by impact.
Each has a concrete fix.

---

## HIGH — fix first

### H1. `/resetdb` never defers → season reset likely fails with "Unknown interaction"
**File:** `cogs/matchflow.py` `reset_database` (lines ~435–576)

The command does a large amount of async work — reads all players, inserts a
badge per top-10 player, `award_season_placements` (a `fetchall` + `ensure_item`
+ `grant_item` **per player**), archives every player's stats, a full-table
`UPDATE`, then `sync_top10_badge` — **before** its first and only
`interaction.response.send_message` at the very end (line 570). Discord expires
an un-acknowledged interaction after 3 seconds. On any populated database this
will blow past 3s, so the final `send_message` throws `404 Unknown interaction`,
the season-reset embed never appears, and it looks like the command "did
nothing" even though the DB was reset.

**Fix:** `await interaction.response.defer()` as the first line (after the
permission check), and change the final success/error sends to
`interaction.followup.send(...)`. Mirrors how `/rank` and `/checkplayer` already
defer.

---

## MEDIUM

### M1. Leaving-penalty scale: applied values don't match what the bot tells users
**Files:** `core/moderation_data.py:13`, `cogs/moderation.py:431–436`

The applied penalties are `LEAVING_PENALTY_MAP = {1:10, 2:15, 3:18, 4:22, 5:25,
6:30, 7:35}` (max 40). But `/leavinghistory` prints a *different* scale:

```
1st: -15 • 2nd: -18 • 3rd: -22 • 4th: -25 • 5th: -30 • 6th: -30 • 7th: -35 • 8th+: -40
```

So a first-time leaver is docked 10 Elo but told the penalty is 15; the "6th"
entry (30) is duplicated; and the two tables disagree at nearly every step. One
of them is wrong.

**Fix:** decide the intended scale and make one the source of truth. Best:
generate the help text from `LEAVING_PENALTY_MAP` instead of hardcoding it, e.g.
build the string by iterating `sorted(LEAVING_PENALTY_MAP.items())` + the
`LEAVING_PENALTY_MAX` tail, so they can never drift again.

### M2. Top 10 *role* and Top 10 *badge* disagree right after a season reset
**Files:** `cogs/roles.py:24`, `cogs/ranking.py:1157` vs `core/cosmetics.py:232`

`refresh_top10_roles` and `/update_roles` compute the top set with
`elo >= TOP10_MIN_ELO`, and `TOP10_MIN_ELO = 0` (`config/settings.py:17`), so the
filter is always true. Immediately after `/resetdb` zeroes everyone's Elo, the
"top 10 by elo" query returns 10 arbitrary 0-Elo players and **they get the Top
10 Discord role**. `sync_top10_badge` deliberately guards against exactly this
with an extra `elo > 0` check (see its docstring), so the cosmetic badge is
correct while the role is not — the two views of "who is top 10" diverge.

**Fix:** add the same `and row[1] > 0` guard when building `top_set` in
`refresh_top10_roles` and `update_roles` (and `refresh_top10_command`), so no
role is granted on a zeroed ladder. Alternatively set `TOP10_MIN_ELO = 1`.

### M3. Possible double match-start (queue poll vs Join button)
**File:** `cogs/queue.py` — `poll_web_queue` (606) and `join_button` (392)

Both paths independently check `len(current_queue) >= GAME.queue_size` and then
`await create_game_channel(...)`. `create_game_channel` has `await` points
(channel creation) before it clears the queue, and there is no lock shared
between the 5-second poll loop and the button handler. If a web join fills the
queue at almost the same moment someone clicks Join, both can pass the fill
check and create two game channels for the same players.

**Fix:** guard match creation with an `asyncio.Lock` on the cog (like
`RankingCog._match_lock`), and re-check `len(current_queue) >= queue_size`
*inside* the lock before creating the channel. Set a "starting" flag as the
first thing after the check.

### M4. Redundant Discord-identity sync, one of which reads a cold cache
**Files:** `cogs/sync.py` (whole cog) and `cogs/progression.py:21` + `:83`

Two separate hourly tasks back-fill `players.discord_id`/`discord_username`:
`SyncCog.sync_discord_identities` **and** `ProgressionCog.update_badges` (which
calls its own `sync_discord_identities`). They do the same job twice per hour.
Worse, `SyncCog` iterates `guild.members` (the local cache, which can be empty or
partial right after startup before chunking completes), whereas the progression
version uses `guild.fetch_members(limit=None)` (authoritative). The cache-based
one can silently sync nothing.

**Fix:** delete one of them (keep the `fetch_members`-based `ProgressionCog`
version, or move it into `SyncCog` and drop it from the badge loop). Whichever
you keep should use `fetch_members`.

### M5. Elo-refresh fan-out on every single Elo change
**Files:** `main.py:79` (`_schedule_top10_refresh`) + `core/players.py:50`

`update_player_elo` fires the observer, which schedules
`refresh_top10_roles(bot)` — and that iterates `guild.fetch_members(limit=None)`
(a full member fetch + per-member role diff). This runs on **every**
`/addelo`, `/removeelo`, and each leaving-penalty application. A staff member
adjusting several players, or a burst of leaving penalties, triggers repeated
full-guild scans.

**Fix:** debounce it — coalesce refreshes scheduled within a few seconds into
one (e.g. cancel/reschedule a single pending task), or only refresh when the
changed player is plausibly near the top 10.

### M6. Website: N+1 queries and fully-sequential awaits on hot profile paths
**Files:** `app/api/matches/[matchId]/route.ts:54–79`, `app/api/players/[name]/route.ts:64–108`

- `matches/[matchId]` calls `await getPlayer(p.player_name)` once **per player**
  inside `buildPlayerStats` — up to ~20 separate DB round-trips per match view.
- `players/[name]` awaits `getPlayer`, `getMatchesForPlayer`, `getMostPlayedWith`,
  `getPlayerRankings`, `getEquippedCosmetics`, `getFriends`, `getInventory` one
  after another; most are independent and could run concurrently.

**Fix:** for the match view, fetch all needed players in one `WHERE name IN (...)`
query (there's already `resolvePlayers`-style batching in `lib/social.ts` to copy).
For the profile view, wrap the independent calls in `Promise.all([...])`.

### M7. `getMatchesForPlayer` returns the entire match history (no LIMIT)
**File:** `HL website/hyperleague/lib/db.ts:224–241`

`ORDER BY id DESC` with no `LIMIT`. The profile page uses it to build
`eloHistory` and `matchHistory` for the whole career. As players accumulate
hundreds/thousands of rows this grows unbounded per profile load.

**Fix:** add a `LIMIT` (e.g. 100) for the display list, and if you want the full
Elo curve, compute it with a dedicated lighter query (just `elo_change`,
`timestamp`) rather than hydrating every column of every match.

---

## LOW

### L1. Win detection hardcodes `"W"` in the achievement path
**File:** `cogs/ranking.py:508`

`/rank` computes `won_match` from `win_label = GAME.win_label.upper()`
everywhere except the achievement loop, which uses `if result.upper() == "W"`.
It works today because the CS profile's `win_label` is `"W"`, but the whole
game-profile system exists to support other games; a profile with a different
label would count Elo wins while never incrementing "Wins Mastery".

**Fix:** reuse `win_label` here too: `if result.strip().upper() == win_label`.

### L2. Bot's `/profile` Elo graph includes placement rows; website excludes them
**Files:** `rendering/elo_graph.py:31` vs `lib/db.ts:230` (`getMatchesForPlayer`)

The bot graph query has no `is_placement` filter, so placement-progress rows
(elo_change 0) and the graduation jump (`starting_elo - 0`, a big spike) are
plotted, while the website's graph filters `COALESCE(is_placement,0)=0`. Same
player, two different curves.

**Fix:** add `AND COALESCE(is_placement, 0) = 0` to the query in
`render_elo_graph` to match the website.

### L3. `/setcolor` stores an unvalidated string
**File:** `cogs/players_admin.py:350–361`

`hex_color` is written verbatim to `players.profile_color`. The bot guards its
own `int(..., 16)` parse, but the raw value also flows to the website. Depending
on how the site applies it (inline `style`/CSS var), a non-hex value is at least
a rendering bug and potentially a CSS-injection vector.

**Fix:** validate with `re.fullmatch(r"#?[0-9A-Fa-f]{6}", hex_color)` and reject
otherwise; normalize to a leading `#`.

### L4. `/addplayer` can attempt duplicate inserts within one call
**File:** `cogs/players_admin.py:82–96`

Each name is checked against the DB, but two identical names in one
comma-separated call both pass the check (neither is in the DB yet) and the
second `INSERT` then violates the unique `idx_players_name`, raising inside the
loop with no try/except.

**Fix:** dedupe the parsed names (preserve order) and/or track names added this
call before inserting; wrap the insert so one bad name doesn't abort the rest.

### L5. Mixed timezones in `match_history.timestamp`
**Files:** `cogs/ranking.py:103` (`_now_str`, local time) vs the column default
`CURRENT_TIMESTAMP` (UTC)

Rows written by `/rank` use naive **local** time; any row relying on the column
default uses **UTC**. They coexist in one TEXT column that's ordered and
date-sliced by the website. If the host isn't on UTC, ordering/date labels can be
off by the offset.

**Fix:** use UTC in `_now_str` (`datetime.now(timezone.utc).strftime(...)`) so
both sources agree, matching what `core/moderation_data.leaving_window_cutoff`
already does.

### L6. `display_player_achievements` can `KeyError` on a legacy achievement name
**File:** `core/achievements.py:96`

It indexes `ACHIEVEMENT_THRESHOLDS[name]` for each row read from the DB. A row
whose `achievement_name` is no longer in the dict (renamed/removed achievement)
crashes the whole listing.

**Fix:** `thresholds = ACHIEVEMENT_THRESHOLDS.get(name); if not thresholds:
continue` (skip unknown achievements gracefully).

### L7. In-flight match Views die on bot restart
**File:** `cogs/matchflow.py` (MapVoteView, SideSelectionView, TeamSelectionView)

These are created with `timeout=None` but have no `custom_id` and aren't
re-registered via `bot.add_view`, so after a restart their buttons are dead and a
match mid-veto is stuck. Only `QueueView` is persistent. (Known limitation, but
worth a note; a stuck veto currently needs staff to restart the flow.)

**Fix:** either accept it and document it, or give the veto buttons stable
custom_ids and persist enough state to rehydrate them. Low priority given how
short a veto is.

### L8. `announcements` route reads the bot token off the filesystem
**File:** `app/api/discord/announcements/route.ts:22–34`

Falls back to reading `../../.env` and regex-scraping `DISCORD_TOKEN`. On Vercel
there is no such file and the working directory differs, so this fallback is dead
weight there; it also couples the site to the bot's repo layout.

**Fix:** rely solely on `process.env.DISCORD_BOT_TOKEN` (set it in Vercel) and
drop the file-reading branch.

---

## Maintainability / coupling notes (not bugs today)

- **Rank-string duplication.** `lib/db.ts:17` `RANK_DB_MAP` hardcodes the exact
  rank name strings from `config/games/counterstrike.toml`. They match right now,
  but a rename/re-band in the TOML would silently map every rank to `UNRANKED` on
  the website with no error. Consider exposing the rank table via an API the site
  reads, or at least a shared constants file / a test that asserts they match.
- **Secrets.** Per project memory, the Discord token and Gemini key were once
  hardcoded. Source is now clean (both read from `.env`, which is gitignored),
  but confirm both keys have actually been **rotated** since the leak — a
  gitignore doesn't undo exposure in history.
- **Test suite needs `pytest-asyncio`.** `tests/test_undo.py`'s async tests fail
  under `pytest` ("async def functions are not natively supported") because the
  plugin isn't installed/declared. The three failures are false negatives — the
  file also runs standalone via `python tests/test_undo.py`. Add `pytest-asyncio`
  to dev deps and set `asyncio_mode = auto`, or these tests are effectively
  skipped in CI.

---

## Suggested order of work
1. **H1** (`/resetdb` defer) — one-line-ish fix, prevents a broken season reset.
2. **M2** + **M1** (top-10 role guard, penalty-scale truth) — user-visible correctness.
3. **M3** (double match-start lock) and **M4/M5** (sync/refresh redundancy).
4. **M6/M7** (website query batching + limits) as traffic grows.
5. Low-severity items opportunistically.
