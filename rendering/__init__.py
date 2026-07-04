"""Image rendering (matplotlib Elo graph + PIL profile card).

These are synchronous, CPU-bound builders; call them via ``asyncio.to_thread``
so they don't block the bot's event loop.
"""
