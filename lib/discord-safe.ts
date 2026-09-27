/**
 * Make user-written text safe to embed in a Discord message the bot sends
 * (DMs, match-channel mirror) — docs/WEBSITE_SECURITY_REPORT.md H4 / L4.
 *
 * Escapes markdown so `[text](url)` can't become a masked link and `**` / `#`
 * can't restyle the bot's message, breaks raw links and invites so they aren't
 * clickable, and defuses @mentions. The bot's own text around it (bold labels,
 * the site URL) is left alone by only running this on the user's part.
 */

const MARKDOWN = /([\\*_~`|>[\]()#-])/g;

export function discordSafe(text: string, max = 400): string {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .slice(0, max)
    .replace(MARKDOWN, "\\$1")
    // "https://evil.example" → "https[:]//evil.example" (not auto-linked)
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, "$1[:]//")
    // bare invites / links Discord would still auto-link
    .replace(/\b(discord(?:app)?\.(?:gg|com)|dsc\.gg)\//gi, "$1[/]")
    // "@everyone", "@here", "<@123>" — no pings, even where mentions are parsed
    .replace(/@/g, "@​")
    .replace(/</g, "<​");
}
