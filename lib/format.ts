/**
 * Display formatting helpers shared across API routes and components.
 *
 * The bot stores raw values (e.g. "de_mirage", "EU-West-2", relative avatar
 * paths). These helpers turn them into clean, user-facing strings.
 */

/** Pretty map names keyed by the raw value the bot writes to the DB. */
const MAP_NAME_MAP: Record<string, string> = {
  de_mirage: "Mirage",
  de_dust2: "Dust II",
  de_inferno: "Inferno",
  de_overpass: "Overpass",
  de_vertigo: "Vertigo",
  de_nuke: "Nuke",
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  de_cache: "Cache",
  de_train: "Train",
};

/** Turn a raw map value ("de_mirage", "Vertigo", null) into a clean label. */
export function prettyMap(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const key = raw.toLowerCase();
  if (MAP_NAME_MAP[key]) return MAP_NAME_MAP[key];
  // Strip a leading "de_"/"cs_" prefix and title-case the rest.
  const stripped = raw.replace(/^(de_|cs_)/i, "").replace(/_/g, " ");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Normalise the region label the bot stores. */
export function prettyRegion(raw: string | null | undefined): string {
  if (!raw) return "EU";
  const map: Record<string, string> = {
    "eu-west-2": "EU",
    europe: "EU",
    eu: "EU",
    "us-east-1": "NA",
    na: "NA",
  };
  return map[raw.toLowerCase()] ?? raw;
}

/**
 * Turn a raw match region ("EU-West-2", "EU Central-1", "Europe") into a clean
 * display label + a representative flag emoji. These are server regions, not
 * player nationalities, so we keep the label region-level and honest.
 */
export function regionMeta(raw: string | null | undefined): { label: string; flag: string } {
  if (!raw) return { label: "Unknown", flag: "🌐" };
  const r = raw.toLowerCase();
  if (r.includes("west")) return { label: "EU West", flag: "🇪🇺" };
  if (r.includes("central")) return { label: "EU Central", flag: "🇪🇺" };
  if (r.includes("north")) return { label: "EU North", flag: "🇪🇺" };
  if (r.includes("eu") || r.includes("europe")) return { label: "EU", flag: "🇪🇺" };
  if (r.includes("us") || r.includes("na") || r.includes("america")) return { label: "NA", flag: "🇺🇸" };
  if (r.includes("ap") || r.includes("asia") || r.includes("oce")) return { label: "APAC", flag: "🌏" };
  return { label: raw, flag: "🌐" };
}

/**
 * Convert the avatar value the bot stores (e.g. "avatars/2474682029.png")
 * into a URL the website can actually serve. Returns "" when there is none.
 */
export function avatarUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  // Strip any leading "avatars/" or slashes, serve via our file route.
  const file = raw.replace(/^\/?avatars\//, "").replace(/^\/+/, "");
  return `/api/avatar/${encodeURIComponent(file)}`;
}
