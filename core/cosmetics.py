"""Cosmetic items: profile cards, titles, and badges (the FACEIT-style
inventory shared with the website).

Pure DB logic — no Discord imports — so it's callable from admin commands,
scheduled tasks, the season reset, and (later) event code. The website mirrors
the schema and owns the equip/unequip flow (HL website .../lib/cosmetics.ts);
this module owns the catalog and grant/revoke paths.

Tables (created in core.schema.ensure_schema):
    cosmetic_items      the catalog (slug, type card|title|badge, name, asset…)
    cosmetic_inventory  who owns what + equipped flag

Timestamps are epoch-ms ints (never pass a raw datetime — libsql serializes it
to int-ms anyway, so we store ints deliberately and consistently).
"""

import logging
import re
import time

from config.settings import TOP10_COUNT, TOP10_MIN_ELO
from core import db

logger = logging.getLogger(__name__)

# Slug for the dynamic "currently in the top 10" badge (seeded at startup).
TOP10_BADGE_SLUG = "top10-current"

# Season placement tiers, best first: (max standing, tier label). A player gets
# only the best tier they reach — #1 gets Champion (not also Top 3 / Top 10).
PLACEMENT_TIERS = [(1, "Champion"), (3, "Top 3"), (10, "Top 10")]

_SLUG_RE = re.compile(r"^[a-z0-9-]{2,40}$")


def now_ms() -> int:
    return int(time.time() * 1000)


def valid_slug(slug: str) -> bool:
    return bool(_SLUG_RE.match(slug))


def slugify(text: str) -> str:
    """Free text -> catalog slug ('Season 1' -> 'season-1')."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]", "-", text.strip().lower())).strip("-")


async def ensure_item(
    slug: str,
    item_type: str,
    name: str,
    description: str = "",
    asset: str | None = None,
    category: str | None = None,
    season: str | None = None,
    rarity: str = "common",
    price: int = 0,
) -> int | None:
    """Create a catalog item if it doesn't exist (idempotent by slug).
    ``price`` > 0 lists the item in the website shop. Returns the item id, or
    None if the insert raced and the lookup failed."""
    await db.execute(
        """INSERT OR IGNORE INTO cosmetic_items
           (slug, type, name, description, asset, category, season, rarity, created_at, price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (slug, item_type, name, description, asset, category, season, rarity, now_ms(), max(0, price)),
    )
    row = await db.fetchone("SELECT id FROM cosmetic_items WHERE slug = ?", (slug,))
    return row[0] if row else None


async def set_price(slug: str, price: int) -> bool:
    """Set an item's shop price (0 = not for sale). Returns False if no such item."""
    if await get_item(slug) is None:
        return False
    await db.execute(
        "UPDATE cosmetic_items SET price = ? WHERE slug = ?", (max(0, price), slug)
    )
    return True


async def get_coins(player_name: str) -> int | None:
    """A player's HL Coin balance, or None if the player doesn't exist."""
    row = await db.fetchone("SELECT coins FROM players WHERE name = ?", (player_name,))
    return int(row[0] or 0) if row else None


async def grant_coins(player_name: str, amount: int) -> int | None:
    """Add ``amount`` HL Coins to a player (negative to remove; balance floored
    at 0). Returns the new balance, or None if the player doesn't exist. This is
    the ONLY source of coins for now."""
    current = await get_coins(player_name)
    if current is None:
        return None
    new_balance = max(0, current + amount)
    await db.execute(
        "UPDATE players SET coins = ? WHERE name = ?", (new_balance, player_name)
    )
    return new_balance


async def ensure_builtin_items() -> None:
    """Seed catalog items the system grants automatically. Idempotent; called
    from ensure_schema() on every startup."""
    await ensure_item(
        TOP10_BADGE_SLUG,
        "badge",
        "Top 10",
        description="Currently in the season's top 10",
        asset=f"/badgeicons/{TOP10_BADGE_SLUG}.png",
        category="dynamic",
        rarity="legendary",
    )


async def get_item(slug: str):
    """Catalog row (id, slug, type, name, description, asset, category, season,
    rarity) or None."""
    return await db.fetchone(
        "SELECT id, slug, type, name, description, asset, category, season, rarity "
        "FROM cosmetic_items WHERE slug = ?",
        (slug,),
    )


async def list_items(item_type: str | None = None):
    """All catalog rows, optionally filtered by type, newest first."""
    if item_type:
        return await db.fetchall(
            "SELECT slug, type, name, description, category, season, rarity "
            "FROM cosmetic_items WHERE type = ? ORDER BY id DESC",
            (item_type,),
        )
    return await db.fetchall(
        "SELECT slug, type, name, description, category, season, rarity "
        "FROM cosmetic_items ORDER BY id DESC"
    )


async def get_inventory(player_name: str):
    """A player's items: (slug, type, name, rarity, equipped, granted_by)."""
    return await db.fetchall(
        """SELECT i.slug, i.type, i.name, i.rarity, inv.equipped, inv.granted_by
           FROM cosmetic_inventory inv JOIN cosmetic_items i ON i.id = inv.item_id
           WHERE inv.player_name = ? ORDER BY i.type, inv.granted_at DESC""",
        (player_name,),
    )


async def grant_item(player_name: str, slug: str, granted_by: str) -> str:
    """Grant a catalog item to a player. This is THE grant path — admin
    commands, top-10 sync, season resets, and future events all call it.

    Returns "granted" | "already_owned" | "no_such_item" | "no_such_player".
    """
    item = await get_item(slug)
    if item is None:
        return "no_such_item"
    player = await db.fetchone("SELECT 1 FROM players WHERE name = ?", (player_name,))
    if player is None:
        return "no_such_player"
    owned = await db.fetchone(
        "SELECT 1 FROM cosmetic_inventory WHERE player_name = ? AND item_id = ?",
        (player_name, item[0]),
    )
    if owned:
        return "already_owned"
    await db.execute(
        """INSERT OR IGNORE INTO cosmetic_inventory
           (player_name, item_id, granted_by, granted_at) VALUES (?, ?, ?, ?)""",
        (player_name, item[0], granted_by, now_ms()),
    )
    return "granted"


async def revoke_item(player_name: str, slug: str) -> bool:
    """Take an item away. Deleting the inventory row atomically removes its
    equipped state too; if it was the player's equipped *title*, also clear the
    players.title mirror so /checkplayer stops showing it."""
    item = await get_item(slug)
    if item is None:
        return False
    row = await db.fetchone(
        "SELECT equipped FROM cosmetic_inventory WHERE player_name = ? AND item_id = ?",
        (player_name, item[0]),
    )
    if row is None:
        return False
    stmts = [(
        "DELETE FROM cosmetic_inventory WHERE player_name = ? AND item_id = ?",
        (player_name, item[0]),
    )]
    if item[2] == "title" and row[0]:
        stmts.append(("UPDATE players SET title = '' WHERE name = ?", (player_name,)))
    await db.batch(stmts)
    return True


async def delete_item(slug: str) -> bool:
    """Remove an item from the catalog and every inventory. Clears the
    players.title mirror for anyone who had it equipped as a title."""
    item = await get_item(slug)
    if item is None:
        return False
    stmts = []
    if item[2] == "title":
        holders = await db.fetchall(
            "SELECT player_name FROM cosmetic_inventory WHERE item_id = ? AND equipped = 1",
            (item[0],),
        )
        for (holder,) in holders:
            stmts.append(("UPDATE players SET title = '' WHERE name = ?", (holder,)))
    stmts.append(("DELETE FROM cosmetic_inventory WHERE item_id = ?", (item[0],)))
    stmts.append(("DELETE FROM cosmetic_items WHERE id = ?", (item[0],)))
    await db.batch(stmts)
    return True


async def sync_top10_badge() -> None:
    """Reconcile the dynamic Top 10 badge with the live standings: grant it to
    players entering the top 10, delete it from players who dropped out.

    Ordering matches cogs.roles.refresh_top10_roles, with one deliberate
    divergence: we additionally require elo > 0, so a fresh season reset (all
    Elo zeroed) doesn't hand the badge to 10 arbitrary players.
    """
    rows = await db.fetchall(
        "SELECT name, elo FROM players ORDER BY elo DESC, matches_won DESC LIMIT ?",
        (TOP10_COUNT,),
    )
    top_set = {r[0] for r in rows if r[1] >= TOP10_MIN_ELO and r[1] > 0}

    item = await get_item(TOP10_BADGE_SLUG)
    if item is None:  # seed missing (shouldn't happen after ensure_schema)
        await ensure_builtin_items()
        item = await get_item(TOP10_BADGE_SLUG)
        if item is None:
            return
    holders = {
        r[0]
        for r in await db.fetchall(
            "SELECT player_name FROM cosmetic_inventory WHERE item_id = ?", (item[0],)
        )
    }

    for name in top_set - holders:
        await grant_item(name, TOP10_BADGE_SLUG, "system:top10")
    dropped = holders - top_set
    if dropped:
        await db.batch([
            (
                "DELETE FROM cosmetic_inventory WHERE player_name = ? AND item_id = ?",
                (name, item[0]),
            )
            for name in dropped
        ])


async def award_season_placements(season_name: str) -> list[str]:
    """At season reset: grant each top player the badge for the best placement
    tier they reached (see PLACEMENT_TIERS). Creates the season's catalog items
    on the fly. Must run while the standings are still live (before the Elo
    reset). Uses /resetdb's exact ordering. Returns "Name — Tier" lines for the
    reset embed.
    """
    max_n = max(n for n, _ in PLACEMENT_TIERS)
    standings = [
        r[0]
        for r in await db.fetchall(
            """SELECT name FROM players WHERE elo > 0
               ORDER BY elo DESC, matches_won DESC, matches_played ASC LIMIT ?""",
            (max_n,),
        )
    ]

    season_slug = slugify(season_name) or "season"
    awarded = []
    for pos, player_name in enumerate(standings, start=1):
        # Best (first) tier whose cutoff covers this standing.
        tier_label = next(label for n, label in PLACEMENT_TIERS if pos <= n)
        slug = f"{season_slug}-{slugify(tier_label)}"
        await ensure_item(
            slug,
            "badge",
            f"{tier_label} — {season_name}",
            description=f"Finished {tier_label.lower()} in {season_name}",
            asset=f"/badgeicons/{slug}.png",
            category="seasonal",
            season=season_name,
            rarity="legendary" if tier_label == "Champion" else "epic",
        )
        result = await grant_item(player_name, slug, "system:season-reset")
        if result == "granted":
            awarded.append(f"{player_name} — {tier_label}")
    return awarded
