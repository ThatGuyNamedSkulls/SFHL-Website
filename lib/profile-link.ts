/** Profile URLs (docs/PROFILE_UI_PLAN.md, Q4): /profile/<name>, so Discord can preview the link. */

/** Profile tabs that can be linked to with ?tab=. */
export const PROFILE_TABS = [
  "summary",
  "matches",
  "stats",
  "friends",
  "guestbook",
  "inventory",
  "clans",
  "teams",
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number];

export function isProfileTab(value: string | null | undefined): value is ProfileTab {
  return !!value && (PROFILE_TABS as readonly string[]).includes(value);
}

/** "/profile/frostbyte" (or "/profile/frostbyte?tab=stats"). */
export function profileHref(name: string, tab?: ProfileTab): string {
  const base = `/profile/${encodeURIComponent(name.trim())}`;
  return tab && tab !== "summary" ? `${base}?tab=${tab}` : base;
}

/** The player name from a /profile/[name] segment, whether or not it arrives decoded. */
export function nameFromSegment(segment: string): string {
  if (!/%[0-9a-f]{2}/i.test(segment)) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
