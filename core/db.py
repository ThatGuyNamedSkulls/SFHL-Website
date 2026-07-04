"""Async Turso (libsql) data-access layer.

Replaces the previous synchronous ``sqlite3`` layer. The bot now talks to a
remote Turso database over libsql, so every DB call is asynchronous and must be
awaited.

Usage::

    from core import db

    row  = await db.fetchone("SELECT elo FROM players WHERE name = ?", (name,))
    rows = await db.fetchall("SELECT name, elo FROM players")
    await db.execute("UPDATE players SET elo = ? WHERE name = ?", (elo, name))

For several writes that must be atomic, use :func:`batch`::

    await db.batch([
        ("UPDATE players SET elo = ? WHERE name = ?", (e1, n1)),
        ("UPDATE players SET elo = ? WHERE name = ?", (e2, n2)),
    ])

A libsql ``Row`` supports both positional (``row[0]``) and column-name
(``row["elo"]``) access, and the SQL uses the same ``?`` placeholders as
sqlite3, so existing queries carry over unchanged.
"""

import logging
import os
from typing import Any, Iterable, Optional, Sequence, Tuple

import libsql_client

logger = logging.getLogger(__name__)

_client: Optional[libsql_client.Client] = None


def get_client() -> libsql_client.Client:
    """Return the process-wide client, created lazily inside the running loop.

    The client is created on first use (which must happen while an asyncio event
    loop is running) and reused for the lifetime of the process.
    """
    global _client
    if _client is None:
        url = os.environ["TURSO_DATABASE_URL"]
        auth_token = os.environ.get("TURSO_AUTH_TOKEN")
        # Force HTTP (Hrana-over-HTTP) transport. A libsql://* URL otherwise makes
        # the pure-Python client open a WebSocket (wss://), whose handshake Turso
        # rejects with "400 Invalid response status". https:// is reliable.
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        elif url.startswith("wss://"):
            url = "https://" + url[len("wss://"):]
        elif url.startswith("ws://"):
            url = "http://" + url[len("ws://"):]
        _client = libsql_client.create_client(url=url, auth_token=auth_token)
        logger.info("Opened libsql client to Turso")
    return _client


async def close() -> None:
    """Close the client (call on bot shutdown)."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
        logger.info("Closed libsql client")


def _params(params: Optional[Sequence[Any]]) -> list:
    return list(params) if params else []


async def execute(sql: str, params: Optional[Sequence[Any]] = None):
    """Run one statement.

    Returns the libsql ``ResultSet`` which exposes ``.rows``, ``.rows_affected``
    and ``.last_insert_rowid``.
    """
    return await get_client().execute(sql, _params(params))


async def fetchone(sql: str, params: Optional[Sequence[Any]] = None):
    """Return the first result row (``row[0]`` / ``row['col']``) or ``None``."""
    rs = await get_client().execute(sql, _params(params))
    return rs.rows[0] if rs.rows else None


async def fetchall(sql: str, params: Optional[Sequence[Any]] = None) -> list:
    """Return all result rows as a list (possibly empty)."""
    rs = await get_client().execute(sql, _params(params))
    return rs.rows


async def batch(statements: Iterable[Tuple[str, Optional[Sequence[Any]]]]) -> None:
    """Atomically run several ``(sql, params)`` pairs in a single transaction."""
    stmts = [libsql_client.Statement(sql, _params(params)) for sql, params in statements]
    await get_client().batch(stmts)
