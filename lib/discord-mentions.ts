/**
 * Turn Discord message markup into readable pieces for the website:
 *   <@&roleId>  -> @Role Name (with the role's colour)
 *   <#channelId> -> #channel-name (links to the channel in Discord)
 *   <@userId> / <@!userId> -> @Display Name
 *   <:emoji:id> / <a:emoji:id> -> :emoji:
 *   <t:unix> / <t:unix:style> -> a readable date
 * Unknown ids fall back to "@unknown-role" / "#unknown-channel" rather than
 * leaking raw ids. Safe to import from client components (no server deps).
 */

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "role"; text: string; color: string | null }
  | { type: "channel"; text: string; url: string | null }
  | { type: "user"; text: string }
  | { type: "everyone"; text: string };

export interface MentionLookup {
  roles: Map<string, { name: string; color: number }>;
  channels: Map<string, string>;
  users: Map<string, string>;
  guildId?: string | null;
}

const TOKEN = /<@&(\d+)>|<#(\d+)>|<@!?(\d+)>|<a?:(\w+):\d+>|<t:(-?\d+)(?::([tTdDfFR]))?>|@everyone|@here/g;

function roleColor(color: number): string | null {
  return color > 0 ? `#${color.toString(16).padStart(6, "0")}` : null;
}

function formatTimestamp(unix: number, style: string | undefined): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return "";
  switch (style) {
    case "t":
      return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
    case "T":
      return d.toLocaleTimeString("en-GB", { timeZone: "UTC" }) + " UTC";
    case "d":
      return d.toLocaleDateString("en-GB", { timeZone: "UTC" });
    case "D":
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    case "R": {
      const diff = Math.round((unix * 1000 - Date.now()) / 60000);
      const abs = Math.abs(diff);
      const [n, unit] =
        abs < 60 ? [abs, "minute"] : abs < 1440 ? [Math.round(abs / 60), "hour"] : [Math.round(abs / 1440), "day"];
      const label = `${n} ${unit}${n === 1 ? "" : "s"}`;
      return diff >= 0 ? `in ${label}` : `${label} ago`;
    }
    default:
      return (
        d.toLocaleString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        }) + " UTC"
      );
  }
}

/** Split Discord content into text and mention segments. */
export function parseMentions(content: string, lookup: MentionLookup): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.text += text;
    else out.push({ type: "text", text });
  };
  for (const m of content.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    pushText(content.slice(last, at));
    last = at + m[0].length;
    const [raw, roleId, channelId, userId, emoji, unix, style] = m;
    if (roleId) {
      const role = lookup.roles.get(roleId);
      out.push({
        type: "role",
        text: `@${role?.name ?? "unknown-role"}`,
        color: role ? roleColor(role.color) : null,
      });
    } else if (channelId) {
      const name = lookup.channels.get(channelId);
      out.push({
        type: "channel",
        text: `#${name ?? "unknown-channel"}`,
        url: name && lookup.guildId ? `https://discord.com/channels/${lookup.guildId}/${channelId}` : null,
      });
    } else if (userId) {
      out.push({ type: "user", text: `@${lookup.users.get(userId) ?? "unknown-user"}` });
    } else if (emoji) {
      pushText(`:${emoji}:`);
    } else if (unix) {
      pushText(formatTimestamp(Number(unix), style) || raw);
    } else {
      out.push({ type: "everyone", text: raw });
    }
  }
  pushText(content.slice(last));
  return out;
}

/** The same content as plain readable text (for previews and fallbacks). */
export function segmentsToText(segments: MentionSegment[]): string {
  return segments.map((s) => s.text).join("");
}
