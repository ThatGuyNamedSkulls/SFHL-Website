# SFHL — Session Hand-off

_Last updated: 2026-07-01_

## What this project is
- **Discord bot** (Python, repo root `c:\Users\diogo\Downloads\SFHL bot v2`) — CS ranking/matchmaking bot. Cogs in `cogs/`, core logic in `core/`, shared SQLite DB `player_database.db`.
- **Website** (`SFHL website/hyperleague/`) — Next.js 16 + React 19 + Tailwind 4, dark FACEIT-orange theme (`#ff5500`). Reads the same `player_database.db` via `better-sqlite3`. Auth = Discord OAuth (jose JWT cookie).
- Note: `SFHL website/hyperleague/AGENTS.md` warns Next 16 has breaking changes — `params` is a Promise (`await params`), already handled throughout.

## Current task state — ALL COMPLETE & VERIFIED
Everything below builds clean (`npx tsc --noEmit` + `npx next build`), bot tests pass (22/22), and pages were smoke-tested on a local server. Nothing pending.

### 1. Website bug-fixes + FACEIT restructure (done)
- Fixed fixed-navbar overlap → **sticky solid navbar**; rebranded HyperLeague→**SFHL** (footer, metadata).
- Map/region prettify + avatar serving: `lib/format.ts` (`prettyMap`/`prettyRegion`/`avatarUrl`) + `app/api/avatar/[file]/route.ts` (serves bot's `avatars/` PNGs, path-traversal guarded).
- Leaderboards: removed fake random trend, added search, "YOU" row highlight.
- Homepage: real **Recent Matches** feed + real stats (replaced fake tournaments/Valorant maps).
- Tournaments: de-faked to SFHL cups + CS maps + "Preview" banner.

### 2. `/rank` command semantics change (done — user-approved model)
- **`scores`** param = per-player individual score → **drives Elo** (kept the existing "performance" Elo model; `core/elo.py` untouched, tests still pass).
- **`points`** param = **team round score** `winners,losers` (e.g. `13,11`).
- Stored in new `match_history.round_score TEXT` column (added in `core/schema.py` + applied to live DB).
- Website match room shows real `13:11` scoreline (falls back to summed points for legacy rows via `scoreType`).
- MVP star on match results = **single overall match MVP** (max mvps, tie-break points) in `app/api/matches/[matchId]/route.ts`.
- `ocr2rank` updated to emit `scores:` and prompt for `points:`.

### 3. Fixes from user report (done)
- **Dropdown crash** (`MenuGroupContext is missing`): `components/ui/dropdown-menu.tsx` `DropdownMenuLabel` now renders a plain `div` instead of Base UI `Menu.GroupLabel`.
- Navbar user menu → Profile / **Settings** / Logout; profile link works.
- **Search autocomplete**: `components/player-search.tsx` (keyboard nav, suggestions dropdown).
- New **`/settings`** page (`app/settings/page.tsx`).

### 4. FACEIT deep-dive plan implemented (3 phases, all done)
Plan file: `C:\Users\diogo\.claude\plans\research-faceit-com-and-take-misty-lampson.md`
- **Phase 1:** `components/ui/skeleton.tsx`, `components/empty-state.tsx`, `components/page-header.tsx`; **real rank icons** (copied `RankPNGs/` → `public/ranks/` d…s3.png; `rank-badge.tsx` uses images, STAR/Unranked fall back to letter badge); match-room two-team avatar headers + per-team totals + MVP row highlight.
- **Phase 2:** profile split into **Overview / Matches / Maps** tabs; `components/stats-filters.tsx` (map/result/time-range) + `applyMatchFilters`; `components/map-stats-table.tsx`; derived metrics (streak, last-10 W-L, Elo Δ last 10, MVP rate).
- **Phase 3:** new **`/ranks`** explainer (`app/ranks/page.tsx`), new **`/matches`** browser (`app/matches/page.tsx`), navbar **queue-status pill** (`components/queue-pill.tsx`) polling `/api/queue`, nav breakpoint moved to `lg`, footer + nav updated with Matches/Ranks.

## Key architectural decisions
- **Elo driver stays "individual score"** (user chose this over round-margin/win-loss). `points` (rounds) is display/record only — do NOT wire it into Elo math.
- Data we DON'T have (so never fake): ADR, RWS, entries/trades/clutches, multi-kills, round-by-round timeline, map veto, country/flags, match "type" (only "Competitive"). Marked N/A / omitted.
- Website reads DB with explicit column SELECTs (`lib/db.ts`) — safe to add DB columns without breaking it.
- `match_history.points` column = per-player individual score (unchanged consumers: achievements, placement, `/checkperformance`, undo).

## MCP / browser setup (just added — NEEDS SESSION RESTART)
- Added project-scoped **`.mcp.json`** (repo root) with Playwright MCP:
  `{ "mcpServers": { "playwright": { "command": "cmd", "args": ["/c","npx","@playwright/mcp@latest"] } } }`
- Chromium already installed (`~/AppData/Local/ms-playwright/chromium-1228` + headless shell).
- **Next session must:** approve the project MCP server when prompted, verify with `/mcp`. Then tools like `browser_navigate` / `browser_take_screenshot` become available.

## Suggested next steps
1. **New session:** approve Playwright MCP, then actually screenshot faceit.com (all sections) + our own site on `localhost` to visually QA the FACEIT-style changes (match room, profile tabs, rank icons).
2. Optional future (needs bot data capture, out of current scope): store ADR/RWS/entries/trades/clutches/round-timeline via `/rank` + `core/schema.py` + `finalocr.py` to unlock FACEIT-depth match stats.
3. Optional polish: home "your snapshot" strip when logged in; leaderboard level-band ladder tabs; country/flags once captured.

## How to run / verify
- Website: `cd "SFHL website/hyperleague"` → `npx next build` (verify) / `npx next start -p <port>` (smoke test). Dev: `npm run dev`.
- Bot tests: repo root → `python -m pytest tests/ -q` (22 pass).
- DB checks: read-only `python -c "import sqlite3; ..."` against `player_database.db` (14 players, 55 match rows). To test the round-score scoreline: temporarily set a match's `round_score='13,11'`, check `/api/matches/<id>` (`scoreType: rounds`), then restore to NULL.

## Leaked secrets (from memory — unrelated to this work)
- Discord token + Gemini key were historically hardcoded and should be rotated. `.env.local` holds the Discord client secret (expected for local dev).
