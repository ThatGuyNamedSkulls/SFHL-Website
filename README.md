# SFHL Bot

A Discord bot for running competitive PUG (pick-up game) matchmaking: queues,
parties, balanced team selection, map veto, Elo ranking, placement matches,
achievements/badges, moderation tooling, OCR-based scoreboard parsing, and
generated profile cards.

> **Status:** mid-refactor. The bot is being restructured from a single
> `main.py` into a package, and being made **config-driven** so it can support
> games other than Counter-Strike via a single game-profile file. See
> [Refactor roadmap](#refactor-roadmap) below.

## Setup

1. Install Python 3.11+ (developed on 3.13).
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Create your secrets file:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and fill in:
   - `DISCORD_TOKEN` — your bot token from the
     [Discord Developer Portal](https://discord.com/developers/applications).
   - `GEMINI_API_KEY` — a Google Gemini key from
     [Google AI Studio](https://aistudio.google.com/app/apikey) (used by the
     `/ocr2rank` scoreboard reader).

   > ⚠️ **Security:** these credentials were previously hardcoded in source and
   > are therefore considered compromised. Rotate (regenerate) both before any
   > real use. `.env` is gitignored; never commit it.

4. Run the bot:
   ```bash
   python main.py
   ```

## Project layout

| Path | Purpose |
| --- | --- |
| `main.py` | Bot entrypoint and (currently) command definitions. |
| `finalocr.py` | Gemini-based scoreboard OCR. |
| `core/` | Reusable logic: DB access, schema, rank table, Elo math. |
| `config/` | Bot settings and per-game profiles (`config/games/*.toml`). |
| `RankPNGs/`, `avatars/`, `*.ttf` | Assets for generated profile cards. |
| `player_database.db` | SQLite database (gitignored). |
| `*.log` | Runtime logs (gitignored). |

## Game profiles

The bot reads a single active **game profile** (e.g.
`config/games/counterstrike.toml`) describing the stat columns, map pool,
side/faction names, win condition, rank bands, and Elo bounds. Swapping the
profile changes the bot's behavior without code edits — this is how the bot
supports games other than Counter-Strike.

## Architecture

`main.py` is a ~100-line entrypoint (bot subclass, cog loading + guild sync, Elo
observer, run). All commands live in `cogs/`; reusable logic in `core/`; image
rendering in `rendering/`.

| Package | Modules |
| --- | --- |
| `core/` | db, schema, ranks, elo, players, achievements, moderation_data, roblox, game_profile |
| `cogs/` | moderation, progression, admin, players_admin, ranking, matchflow, queue, profile (+ shared, roles, queue_state) |
| `rendering/` | elo_graph (matplotlib), profile_card (PIL) — both run off the event loop |

## Refactor roadmap

- **Phase 0** — secrets → `.env`, scaffolding, DB backup. ✅
- **Phase 1** — `core/` modules; fixed missing `smurf_flags` table; unified rank config. ✅
- **Phase 2** — game-profile config layer (`core/game_profile.py` + `config/games/*.toml`). ✅
- **Phase 3** — every command split into `cogs/`; `main.py` reduced from 5,493 → ~100 lines. ✅
- **Phase 4** — rendering/OCR isolation: OCR emits JSON + offloaded; matplotlib graph and the PIL profile card render off the event loop. ✅
- **Phase 5** — second game profile (`config/games/valorant.toml`) proving generalization. ✅

### Tests
```bash
python tests/test_core.py             # rank/elo logic == original behavior
python tests/test_profiles.py         # bot is game-agnostic (CS vs Valorant)
python tests/test_elo_team.py         # opponent-aware team_expected Elo model
python tests/test_glicko2.py          # Glicko-2 vs the paper's reference example
python tests/test_undo.py             # /undolastmatch snapshot restore
python tests/test_rank_integration.py # /rank -> /undolastmatch end-to-end
python tests/test_cogs_load.py        # every cog loads; full command set, no duplicates
```
CI (`.github/workflows/tests.yml`) runs `ruff` + all suites on every push/PR.

### Elo models (`elo.model` in the game profile)
- `performance` — original: your own points vs your rank's expected range.
- `team_expected` — opponent-aware: expected score from the team Elo gap + dynamic K + small bonus.
- `glicko2` — full Glicko-2 with rating deviation (RD) + volatility + inactivity decay.

## Match operations & safety
- `/undolastmatch [match_id]` — reverses a match. The **latest** match is reverted
  **exactly** (Elo, rank, match counts, all stat totals, achievements, peak Elo, and
  placement progress/graduations) by restoring a per-row pre-match snapshot stored in
  `match_history.undo_state`. Older matches fall back to best-effort delta reversal.
- `/recentmatches` — lists recent matches with their `match_id` (for `/undolastmatch`).
- The `match_id` is shown in the `/rank` result footer and in `/matchhistory`; legacy
  rows are auto-assigned a synthetic `match_id` (clustered by executor + time) on startup.
- `/backupdb` — timestamped DB snapshot (`backups/`, online-backup API, safe while running);
  also runs automatically once a day (keeps the latest 14).
- `/matchhistory [player]` — recent matches for a player.
- `bot.log` rotates at 5 MB × 3 backups.

```bash
python tests/test_undo.py       # /undolastmatch snapshot restore + achievement revert
```

### Switching games
Set `ACTIVE_GAME_PROFILE` in `config/settings.py` to any file under
`config/games/` (e.g. `valorant.toml`). Rank ladder, maps, sides, stats, win
condition, Elo bounds, and queue size all follow the profile.
