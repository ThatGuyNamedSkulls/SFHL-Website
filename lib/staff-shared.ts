/**
 * Staff panel constants the browser needs too (no server imports here).
 * TIMEOUT_REASONS mirrors the bot's cogs/moderation.py TIMEOUT_REASONS — the
 * bot checks the reason again, so a stale list only means a refused action.
 */

export const TEAM_KILLING = "Team killing";

export const TIMEOUT_REASONS: { reason: string; length: string }[] = [
  { reason: TEAM_KILLING, length: "1 hour per team kill" },
  { reason: "Queue AFK", length: "1 hour" },
  { reason: "Leaving mid game", length: "Elo penalty + matchmaking suspension, 30 min to 3 days" },
  { reason: "Trolling", length: "6 hours" },
  { reason: "Ghosting", length: "7 days" },
  { reason: "Trying to ghost", length: "3 days" },
  { reason: "Unauthorized kicking", length: "6 hours" },
  { reason: "Throwing (Very sure on purpose)", length: "3 days" },
  { reason: "Leaking VIP server link", length: "12 hours" },
];

/** Most team kills one timeout can cover (1 hour each, up to a week) — the bot's limit. */
export const MAX_TEAM_KILLS = 168;

/** A Counter Blox game id, also from a pasted playcbrm.xyz link or "#1Woq74ZG". */
export function parseCbrmGameId(input: string): string | null {
  let raw = String(input ?? "").trim();
  const fromUrl = /playcbrm\.xyz\/matches\/([^/?#\s]+)/i.exec(raw);
  if (fromUrl) raw = fromUrl[1];
  raw = raw.replace(/^#/, "");
  return /^[A-Za-z0-9_-]{3,32}$/.test(raw) ? raw : null;
}

/** The bot's built-in "Top 10 — Current Season" badge: granted automatically, never sold. */
export const TOP10_BADGE_SLUG = "top10-current";

/** Cosmetic item types, as /item create offers them. `folder` = where its image lives under public/. */
export const ITEM_TYPES: { type: string; label: string; folder: string | null }[] = [
  { type: "card", label: "Profile card", folder: "/profilecards/" },
  { type: "frame", label: "Avatar frame", folder: "/avatarframes/" },
  { type: "background", label: "Background", folder: null },
  { type: "title", label: "Title", folder: null },
  { type: "badge", label: "Badge", folder: "/badgeicons/" },
];
export const ITEM_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export const BADGE_CATEGORIES = ["admin", "seasonal", "team"] as const;
/** The bot's slug rule (core/cosmetics.py _SLUG_RE). */
export const ITEM_SLUG_RE = /^[a-z0-9-]{2,40}$/;
/** Titles are shown on profiles as their name: the bot allows 24 characters. */
export const MAX_TITLE_LENGTH = 24;
export const MAX_ITEM_PRICE = 1_000_000;

/** A slug suggestion from an item name: "S1 Gold Card" → "s1-gold-card". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // the accents NFKD split off: "é" → "e"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
