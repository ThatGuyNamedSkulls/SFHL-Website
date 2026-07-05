"""Authoritative database schema for the SFHL bot.

Replaces the scattered ``CREATE TABLE`` / ``try: ALTER ... except`` blocks that
were spread across the top of ``main.py``. :func:`ensure_schema` is idempotent:
it creates every table with its full, current column set on a fresh database,
and back-fills any missing columns on an older database via guarded ``ALTER``s.

It also creates the ``smurf_flags`` table, which the original code queried and
inserted into but never created (so smurf detection silently failed).
"""

import logging
from datetime import datetime

from core import db

logger = logging.getLogger(__name__)


async def _safe_alter(sql: str) -> None:
    """Run an ALTER TABLE, ignoring only the expected 'duplicate column' error
    on already-migrated DBs. Any other failure (bad SQL, missing table, a real
    migration problem) is logged instead of silently swallowed, so a broken
    migration surfaces rather than leaving a column quietly absent."""
    try:
        await db.execute(sql)
    except Exception as e:
        if "duplicate column" in str(e).lower():
            return  # Column already exists — expected on existing databases.
        logger.warning("Migration ALTER failed (%s): %s", sql, e)


async def _backfill_match_ids() -> None:
    """Give legacy match_history rows (match_id IS NULL) a synthetic match_id so
    they're undoable. Clusters rows by executed_by + a 120s timestamp window (one
    /rank call inserts all its players within ~1s), using the cluster's first
    timestamp (epoch seconds) as the id.
    """
    rows = await db.fetchall(
        "SELECT id, executed_by, timestamp FROM match_history WHERE match_id IS NULL "
        "ORDER BY executed_by, timestamp"
    )
    if not rows:
        return

    def parse(ts):
        try:
            return datetime.fromisoformat(ts)
        except (ValueError, TypeError):
            return None

    updates = []
    last_exec, last_dt, current_mid = object(), None, None
    fallback = 1  # for rows with unparseable timestamps
    for rid, ex, ts in rows:
        dt = parse(ts)
        gap_too_big = last_dt is None or dt is None or abs((dt - last_dt).total_seconds()) > 120
        if ex != last_exec or gap_too_big:
            current_mid = int(dt.timestamp()) if dt else -fallback
            fallback += 1
        updates.append((current_mid, rid))
        last_exec, last_dt = ex, dt

    await db.batch(
        [("UPDATE match_history SET match_id = ? WHERE id = ?", u) for u in updates]
    )
    logger.info(f"Backfilled match_id for {len(updates)} legacy match_history rows.")


async def ensure_schema() -> None:
    """Create/upgrade all tables. Safe to call on every startup."""
    # --- players -----------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            elo INTEGER NOT NULL,
            rank TEXT NOT NULL,
            total_kills INTEGER DEFAULT 0,
            total_deaths INTEGER DEFAULT 0,
            total_assists INTEGER DEFAULT 0,
            kd_ratio REAL DEFAULT 0.0,
            total_mvps INTEGER DEFAULT 0,
            total_score INTEGER DEFAULT 0,
            total_headshot_percentage REAL DEFAULT 0.0,
            avg_hs_percent REAL DEFAULT 0.0,
            matches_played INTEGER DEFAULT 0,
            matches_won INTEGER DEFAULT 0,
            placement_points INTEGER DEFAULT 0,
            placement_games_played INTEGER DEFAULT 0,
            placement_done INTEGER DEFAULT 0,
            roblox_avatar_image TEXT DEFAULT NULL,
            roblox_user_id INTEGER DEFAULT NULL,
            total_play_time INTEGER DEFAULT 0,
            peak_elo INTEGER DEFAULT 0,
            title TEXT DEFAULT '',
            profile_color TEXT DEFAULT '#000000',
            season_rewards TEXT DEFAULT '',
            dynamic_flair TEXT DEFAULT '',
            glicko_rd REAL DEFAULT 350.0,
            glicko_vol REAL DEFAULT 0.06,
            last_played TEXT DEFAULT NULL,
            coins INTEGER DEFAULT 0,
            discord_id INTEGER DEFAULT NULL,
            discord_username TEXT DEFAULT NULL
        )
        """
    )
    # Back-fill columns on databases created before these were added.
    await _safe_alter("ALTER TABLE players ADD COLUMN total_play_time INTEGER DEFAULT 0")
    await _safe_alter("ALTER TABLE players ADD COLUMN peak_elo INTEGER DEFAULT 0")
    await _safe_alter("ALTER TABLE players ADD COLUMN title TEXT DEFAULT ''")
    await _safe_alter("ALTER TABLE players ADD COLUMN profile_color TEXT DEFAULT '#000000'")
    await _safe_alter("ALTER TABLE players ADD COLUMN season_rewards TEXT DEFAULT ''")
    await _safe_alter("ALTER TABLE players ADD COLUMN dynamic_flair TEXT DEFAULT ''")
    # Glicko-2 state (used when elo.model = "glicko2").
    await _safe_alter("ALTER TABLE players ADD COLUMN glicko_rd REAL DEFAULT 350.0")
    await _safe_alter("ALTER TABLE players ADD COLUMN glicko_vol REAL DEFAULT 0.06")
    await _safe_alter("ALTER TABLE players ADD COLUMN last_played TEXT DEFAULT NULL")
    # HL Coins: shop currency, granted by /givecoins (only source for now).
    await _safe_alter("ALTER TABLE players ADD COLUMN coins INTEGER DEFAULT 0")
    # Discord identity, synced from the guild: display_name -> players.name (the
    # "roblox username"); discord_username is the @handle shown next to it.
    await _safe_alter("ALTER TABLE players ADD COLUMN discord_id INTEGER DEFAULT NULL")
    await _safe_alter("ALTER TABLE players ADD COLUMN discord_username TEXT DEFAULT NULL")

    # --- match_history -----------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS match_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_name TEXT,
            map_name TEXT,
            region TEXT,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            hs_percentage REAL,
            elo_change INTEGER,
            result TEXT,
            points INTEGER,
            executed_by TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            mvps INTEGER,
            is_highlight INTEGER DEFAULT 0,
            match_id INTEGER,
            round_score TEXT,
            undo_state TEXT
        )
        """
    )
    await _safe_alter("ALTER TABLE match_history ADD COLUMN mvps INTEGER")
    await _safe_alter("ALTER TABLE match_history ADD COLUMN is_highlight INTEGER DEFAULT 0")
    # match_id groups all per-player rows from one /rank call (used by /undolastmatch).
    await _safe_alter("ALTER TABLE match_history ADD COLUMN match_id INTEGER")
    # round_score is the match-level team round score, e.g. "13,11" (winners,losers).
    # Same value on every row of a match; used for the website's match scoreline.
    await _safe_alter("ALTER TABLE match_history ADD COLUMN round_score TEXT")
    # undo_state holds a JSON snapshot of each player's pre-match state for exact undo.
    await _safe_alter("ALTER TABLE match_history ADD COLUMN undo_state TEXT")
    await _backfill_match_ids()

    # --- web_queue ---------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS web_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_user_id TEXT NOT NULL UNIQUE,
            discord_username TEXT NOT NULL,
            player_name TEXT,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- reports -----------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_name TEXT NOT NULL,
            reported_user TEXT NOT NULL,
            reason TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- achievements ------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_name TEXT NOT NULL,
            achievement_name TEXT NOT NULL,
            progress INTEGER DEFAULT 0,
            max_progress INTEGER NOT NULL,
            level TEXT DEFAULT 'Bronze',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- timeouts ----------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS timeouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            reason TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            moderator_id INTEGER NOT NULL,
            moderator_name TEXT NOT NULL,
            expiry_time DATETIME NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- warnings ----------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            warning_count INTEGER DEFAULT 1,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- leaving_incidents -------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS leaving_incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            elo_penalty INTEGER NOT NULL,
            incident_count INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- badges ------------------------------------------------------------
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS badges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_name TEXT NOT NULL,
            badge_name TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # --- social: friends, invites, notifications, DM outbox -----------------
    # Shared with the website (see HL website .../lib/social.ts). Friends etc.
    # are keyed on the player name (unique in `players`). `web_users` maps a
    # player name -> Discord id (captured on login/queue/party) so the bot can
    # DM by user id; the DM outbox `to_id` holds a Discord id when known, else a
    # player name resolved by display name.
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS web_users (
            discord_id  TEXT PRIMARY KEY,
            player_name TEXT,
            username    TEXT,
            updated_at  INTEGER
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS friendships (
            user_a     TEXT NOT NULL,
            user_b     TEXT NOT NULL,
            created_at INTEGER,
            PRIMARY KEY (user_a, user_b)
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS friend_requests (
            from_id    TEXT NOT NULL,
            to_id      TEXT NOT NULL,
            created_at INTEGER,
            PRIMARY KEY (from_id, to_id)
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS party_invites (
            party_id   TEXT NOT NULL,
            from_id    TEXT NOT NULL,
            to_id      TEXT NOT NULL,
            created_at INTEGER,
            PRIMARY KEY (party_id, to_id)
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT NOT NULL,
            type       TEXT NOT NULL,
            message    TEXT NOT NULL,
            actor_id   TEXT,
            ref_id     TEXT,
            read       INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS discord_dm_outbox (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            to_id      TEXT NOT NULL,
            message    TEXT NOT NULL,
            sent       INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER
        )
        """
    )

    # --- cosmetics: profile cards, titles, badge items -----------------------
    # Catalog + per-player inventory for the website's profile customization
    # (FACEIT-style). Mirrored in HL website .../lib/cosmetics.ts. The bot owns
    # the catalog and grant/revoke (see core/cosmetics.py); the website owns
    # equipping. Timestamps are epoch-ms ints (libsql datetime gotcha).
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS cosmetic_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            slug        TEXT NOT NULL UNIQUE,
            type        TEXT NOT NULL,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            asset       TEXT DEFAULT NULL,
            category    TEXT DEFAULT NULL,
            season      TEXT DEFAULT NULL,
            rarity      TEXT DEFAULT 'common',
            created_at  INTEGER,
            price       INTEGER DEFAULT 0
        )
        """
    )
    # price > 0 makes an item purchasable in the website shop (0 = grant-only).
    await _safe_alter("ALTER TABLE cosmetic_items ADD COLUMN price INTEGER DEFAULT 0")
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS cosmetic_inventory (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_name TEXT NOT NULL,
            item_id     INTEGER NOT NULL,
            granted_by  TEXT DEFAULT NULL,
            granted_at  INTEGER,
            equipped    INTEGER NOT NULL DEFAULT 0,
            equipped_at INTEGER
        )
        """
    )
    await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cosmetic_inventory_unique "
        "ON cosmetic_inventory(player_name, item_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_cosmetic_inventory_player "
        "ON cosmetic_inventory(player_name)"
    )
    # Seed the system-granted items (e.g. the dynamic Top 10 badge).
    from core.cosmetics import ensure_builtin_items
    await ensure_builtin_items()

    # --- indexes -----------------------------------------------------------
    await db.execute("CREATE INDEX IF NOT EXISTS idx_match_history_player ON match_history(player_name)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_match_history_match ON match_history(match_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_badges_player ON badges(player_name)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_achievements_player ON achievements(player_name)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_dm_outbox_sent ON discord_dm_outbox(sent)")
    # Enforce unique player names; fall back to a plain index ONLY when the
    # failure is an actual uniqueness violation (legacy duplicate names). Any
    # other error (e.g. missing table) is re-raised so it isn't masked.
    try:
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players(name)")
    except Exception as e:
        if "unique" not in str(e).lower():
            raise
        logger.warning(
            "Duplicate player names present — created a non-unique index. Resolve the "
            "duplicates (e.g. /renameplayer) to enforce uniqueness."
        )
        await db.execute("CREATE INDEX IF NOT EXISTS idx_players_name ON players(name)")

    logger.info("Database schema ensured.")
