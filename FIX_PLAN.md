# Fix Plan — SFHL Bot + HyperLeague Website

Companion to `CODE_REVIEW_REPORT.md` (2026-07-08). Four phases, ordered so the
highest-impact fixes land first and each phase is independently shippable.

**Branch logistics (important):** the bot lives on `master`, the website on
`main`, in the same GitHub repo. Phases 1, 2 and the bot half of Phase 4 are
committed to `master`; Phase 3 and the website half of Phase 4 to `main`.
The bot needs a process restart to pick up changes; the website redeploys via
Vercel on push.

---

## Phase 1 — Bot correctness quick wins (report: H1, M1, M2, L1–L6)

Small, isolated edits. One commit per fix or one commit for the batch.

### 1.1 `/resetdb` defer (H1)
`cogs/matchflow.py`, `reset_database`:
- After the `MM_MANAGER_ROLE` permission check and the empty-args check (both
  of which respond immediately and return), add
  `await interaction.response.defer()`.
- Change the success send (line ~570) and the error send in the `except` block
  (line ~574) from `interaction.response.send_message` to
  `interaction.followup.send`.

### 1.2 Top-10 role guard after season reset (M2)
- `cogs/roles.py:24`: build `top_set` with `if row[1] >= TOP10_MIN_ELO and row[1] > 0`.
- `cogs/ranking.py` `/update_roles` (~line 1157): same guard on `top_set`.
- Matches the guard `core/cosmetics.py:sync_top10_badge` already has, so role
  and badge agree.

### 1.3 Leaving-penalty scale: one source of truth (M1)
**Decision (recommended default):** trust the applied scale in
`core/moderation_data.py:LEAVING_PENALTY_MAP` and fix the display text.
- Add a helper in `core/moderation_data.py`, e.g. `penalty_scale_text()`, that
  renders the map + `LEAVING_PENALTY_MAX` tail ("1st: -10 • 2nd: -15 • … •
  8th+: -40").
- `cogs/moderation.py:431–436`: replace the hardcoded `penalty_info` string
  with that helper.
- If the *displayed* scale (15/18/22/25/30/35/40) was the intended one instead,
  change the map values and keep the helper — say which before this lands.

### 1.4 Win label in achievements (L1)
`cogs/ranking.py:508`: `if result.upper() == "W"` →
`if result.strip().upper() == win_label` (already in scope).

### 1.5 Elo graph placement filter (L2)
`rendering/elo_graph.py:31`: add `AND COALESCE(is_placement, 0) = 0` to the
`match_history` query, matching the website.

### 1.6 `/setcolor` validation (L3)
`cogs/players_admin.py:setcolor`: validate with
`re.fullmatch(r"#?[0-9A-Fa-f]{6}", hex_color)`; reject with an ephemeral error;
normalize to a leading `#` before storing.

### 1.7 `/addplayer` dedupe + empty-name guard (L4)
`cogs/players_admin.py:add_player`: skip empty tokens after `strip()`, dedupe
names within the call (preserve order, report dupes under "Already Exists" or a
new "Duplicate" field), and wrap the `INSERT` in try/except so one failure
doesn't abort the rest.

### 1.8 UTC timestamps (L5)
`cogs/ranking.py:_now_str`: use
`datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")` so `/rank` rows agree
with the column's `CURRENT_TIMESTAMP` default. Also update the `match_log`
timestamp two call sites use for consistency.

### 1.9 Achievement listing crash guard (L6)
`core/achievements.py:display_player_achievements`: replace
`ACHIEVEMENT_THRESHOLDS[name]` with `.get(name)`; `continue` on unknown names.

**Verify Phase 1:**
- `python -m pytest tests/ -q` (expect the 3 known `test_undo.py` async
  failures until Phase 4.1 lands; nothing new may fail).
- `python -m py_compile` on touched files.
- Manual: in the test guild run `/leavinghistory` (text matches map),
  `/setcolor` with bad + good values, `/addplayer "a, a, ,b"`.
- `/resetdb` is destructive — verify the defer change by reading, or run
  against a scratch DB if available. Do NOT run it on the live DB.

---

## Phase 2 — Bot concurrency & task hygiene (M3, M4, M5)

### 2.1 Match-start lock (M3)
`cogs/queue.py`:
- Add `self._start_lock = asyncio.Lock()` to `QueueCog.__init__`.
- Move the "queue full → disable buttons → `create_game_channel`" sequence in
  **both** `join_button` and `poll_web_queue` inside `async with` on that lock,
  re-checking `len(get_current_queue()) >= GAME.queue_size` after acquiring it
  (the second entrant sees the queue already emptied and does nothing).
- `join_button` lives on `QueueView`, not the cog — pass the lock into the view
  (the cog already owns the single shared `QueueView` instance, so add e.g.
  `self.queue_view.start_lock = self._start_lock` and use it in the button).

### 2.2 Single identity sync (M4)
**Decision (recommended):** keep the dedicated `SyncCog`, delete the duplicate.
- `cogs/sync.py`: switch the loop body to `async for member in
  guild.fetch_members(limit=None)` (authoritative, cache-independent); use the
  changed-only UPDATE form from `cogs/progression.py:sync_discord_identities`
  (`WHERE name = ? AND (discord_id IS NOT ? OR discord_username IS NOT ?)`);
  chunk `db.batch` at 100 statements like progression does.
- `cogs/progression.py`: delete `sync_discord_identities` and its call in
  `update_badges` (line ~83).

### 2.3 Debounced top-10 refresh (M5)
`main.py:_schedule_top10_refresh`:
- Keep a module-level `_pending_refresh: asyncio.Task | None`.
- On each observer fire: if a pending task exists and isn't done, do nothing
  (coalesce). Otherwise create a task that `await asyncio.sleep(5)` then runs
  `refresh_top10_roles(bot)` once. A burst of `/addelo`/penalties then costs one
  guild scan instead of N.
- Optional follow-up: switch `refresh_top10_roles` to iterate cached
  `guild.members` instead of `fetch_members` (members intent + chunking is on),
  keeping `fetch_members` only in the explicit `/update_roles` command.

**Verify Phase 2:**
- Tests + compile as before.
- Manual: open `/queue` in the test guild, fill it from web + button at the
  same time where possible; confirm exactly one game channel.
- Watch `bot.log` for one identity-sync line per hour (not two) and a single
  "Top10 refresh" after a burst of Elo changes.

---

## Phase 3 — Website fixes (M6, M7, L8) — branch `main`

### 3.1 Batch player lookup in match detail (M6a)
`app/api/matches/[matchId]/route.ts`:
- Replace the per-player `getPlayer` inside `buildPlayerStats` with one
  pre-fetched map: single `SELECT name, rank, roblox_avatar_image FROM players
  WHERE name IN (...)` over all row names (copy the placeholder pattern from
  `lib/social.ts:resolvePlayers`), then look up from the map.

### 3.2 Parallelize profile route (M6b)
`app/api/players/[name]/route.ts`: after `getPlayer` (needed to 404 early),
run `getMatchesForPlayer`, `getMostPlayedWith`, `getPlayerRankings`,
`getEquippedCosmetics`, `getFriends`, `getInventory`, `resolvePlayerAvatar` in
one `Promise.all`. Keep the existing `.catch(...)` fallbacks per call.

### 3.3 Limit match-history hydration (M7)
`lib/db.ts:getMatchesForPlayer`:
- Add `limit = 100` parameter → `LIMIT ?`.
- Add `getEloHistory(playerName)` returning only `elo_change` (same
  `is_placement` filter, `ORDER BY id DESC`, capped at e.g. 250) and use it in
  `app/api/players/[name]/route.ts` for `eloHistory`, so the Elo curve doesn't
  require full-column hydration.
- Check other `getMatchesForPlayer` callers (`app/api/matches/route.ts`) still
  behave with the limit.

### 3.4 Drop the `.env` file fallback (L8)
`app/api/discord/announcements/route.ts`: delete `getBotToken`'s file-reading
branch and the `fs`/`path` imports; read
`process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN` only.
**Ops step:** confirm `DISCORD_BOT_TOKEN` is set in Vercel env (per deploy
notes it may still be pending) — without it, announcements and the
guild-membership checks return empty/unknown.

**Verify Phase 3:**
- `npm run build` and `npx eslint .` in `HL website/hyperleague`.
- Local run: load a match page (10-player match renders, one players query),
  a profile page (data unchanged, faster), `/alerts` (announcements still load
  with env token).

---

## Phase 4 — Guardrails & maintenance

### 4.1 Make the async tests actually run (bot, `master`)
- Add `pytest-asyncio` to `requirements.txt` (dev section) and configure in
  `pyproject.toml`: `[tool.pytest.ini_options] asyncio_mode = "auto"`.
- Run `python -m pytest tests/ -q` → expect 22/22 passing.

### 4.2 Rank-map drift test (bot, `master`)
New `tests/test_rank_map_sync.py`: parse
`HL website/hyperleague/lib/db.ts` with a regex for the `RANK_DB_MAP` keys and
assert the set equals `{unranked} ∪ {r.name for r in ACTIVE.ranks}` from the
TOML profile. Both files are in the same checkout, so this catches a rename in
either place at test time. (Skip the test gracefully if the website dir is
absent.)

### 4.3 Secrets rotation (manual, do not skip)
Confirm the previously-hardcoded Discord token and Gemini key were **rotated**
(not just moved to `.env`) — regenerate both in the Discord dev portal /
Google AI Studio if in doubt, update `.env` + Vercel env.

### 4.4 Document the view-restart limitation (L7)
Add a note to `README.md`/`hand-off.md`: map-veto/side-pick/team-select views
don't survive a bot restart; staff should re-run the flow if the bot restarts
mid-veto. (Full persistence is deliberately out of scope.)

---

## Decision points (defaults will be used unless overridden)
1. **M1:** applied penalty map is the source of truth; display text regenerated
   from it. Override if the displayed 15/18/22… scale was the intent.
2. **M4:** keep `SyncCog` (upgraded), remove progression's duplicate.
3. **M7:** match-history LIMIT 100, Elo-history cap 250.

## Rollout order
1. Phase 1 → commit to `master`, restart bot, smoke-test.
2. Phase 2 → same, watch logs for a day.
3. Phase 3 → commit to `main`, Vercel deploy, check match/profile/alerts pages.
4. Phase 4 → any time; 4.3 (key rotation) should happen immediately regardless.
