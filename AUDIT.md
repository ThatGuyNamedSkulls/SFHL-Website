# SFHL Bot + HL Website — Bug & Improvement Audit (2026-07-08)

Full read-through of the bot (`main.py`, `core/`, `cogs/`, `rendering/`) and the
website (`HL website/hyperleague`: `lib/`, `app/api/`, key pages). Findings are
ordered by severity; each has the file/line, what goes wrong, and how to fix it.

Test suite status: `19 passed, 3 failed` — the 3 failures are the async tests in
`tests/test_undo.py`, which pytest cannot run without `pytest-asyncio` (see M12).

---

## 🔴 Critical

### C1. Website: player identity is bound by display name — spoofable (account takeover)
**Where:** `HL website/hyperleague/app/api/auth/callback/route.ts:86-100`

Login links the session to a player with
`displayName = userData.global_name || userData.username` → `getPlayer(displayName)`.
Anyone can set their Discord **global name** to an existing player's name, log in,
and the session gets `playerName = <victim>`. From there they control everything
name-keyed: spend the victim's HL Coins (`/api/shop/buy`), equip/unequip their
cosmetics, set their country, remove their friends, and re-point
`web_users.player_name` at their own Discord id so the victim's friend/party DMs
route to the attacker. Guild membership is **not** required for any of these
endpoints — only for queueing.

**Fix:** make `players.discord_id` the primary binding:
1. On login, first look up `players WHERE discord_id = ?` (the bot's hourly sync
   populates this column).
2. Fall back to the name match **only** when that row's `discord_id IS NULL`
   (first-time claim), and require `inGuild === true` to claim.
3. If the name-matched row has a *different* non-null `discord_id`, do **not**
   link — treat as unlinked.

### C2. Bot: hourly identity sync can be poisoned by nickname squatting
**Where:** [cogs/sync.py:41-50](cogs/sync.py#L41-L50) (and the duplicate in
[cogs/progression.py:21-41](cogs/progression.py#L21-L41))

`UPDATE players SET discord_id = ?, discord_username = ? WHERE name = <display_name>`
runs for