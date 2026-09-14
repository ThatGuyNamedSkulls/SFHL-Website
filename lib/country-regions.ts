import { COUNTRY_CODES } from "@/data/country-codes";
import type { PlayRegionId } from "@/lib/regions";

/**
 * ISO country → matchmaking region. The leaderboard region filter uses this
 * so a player from Portugal lands on EU, USA on NA, Brazil on SA, etc.
 *
 * There is no Africa / Middle East queue, so those countries sit on EU
 * (typical CS ping + how FACEIT-style boards group them).
 */
const REGION_COUNTRIES: Record<PlayRegionId, readonly string[]> = {
  EU: [
    // Europe
    "ad", "al", "at", "ax", "ba", "be", "bg", "by", "ch", "cy", "cz", "de", "dk",
    "ee", "es", "fi", "fo", "fr", "gb", "ge", "gg", "gi", "gl", "gr", "hr", "hu",
    "ie", "im", "is", "it", "je", "li", "lt", "lu", "lv", "mc", "md", "me", "mk",
    "mt", "nl", "no", "pl", "pt", "ro", "rs", "ru", "se", "si", "sj", "sk", "sm",
    "ua", "va", "xk",
    // Turkey + Caucasus
    "am", "az", "tr",
    // Middle East
    "ae", "bh", "il", "iq", "ir", "jo", "kw", "lb", "om", "ps", "qa", "sa", "sy", "ye",
    // Central Asia (queued on EU in this league)
    "kg", "kz", "tj", "tm", "uz",
    // Africa
    "ao", "bf", "bi", "bj", "bw", "cd", "cf", "cg", "ci", "cm", "cv", "dj", "dz",
    "eg", "eh", "er", "et", "ga", "gh", "gm", "gn", "gq", "gw", "ke", "km", "lr",
    "ls", "ly", "ma", "mg", "ml", "mr", "mu", "mw", "mz", "na", "ne", "ng", "re",
    "rw", "sc", "sd", "sh", "sl", "sn", "so", "ss", "st", "sz", "td", "tf", "tg",
    "tn", "tz", "ug", "yt", "za", "zm", "zw",
    "bv",
  ],
  NA: [
    "ag", "ai", "aw", "bb", "bl", "bm", "bq", "bs", "bz", "ca", "cr", "cu", "cw",
    "dm", "do", "gd", "gp", "gt", "hn", "ht", "jm", "kn", "ky", "lc", "mf", "mq",
    "ms", "mx", "ni", "pa", "pm", "pr", "sv", "sx", "tc", "tt", "um", "us", "vc",
    "vg", "vi",
  ],
  SA: [
    "ar", "bo", "br", "cl", "co", "ec", "fk", "gf", "gs", "gy", "pe", "py", "sr",
    "uy", "ve",
  ],
  APAC: [
    "af", "bd", "bn", "bt", "cn", "gu", "hk", "id", "in", "io", "jp", "kh", "kp",
    "kr", "la", "lk", "mm", "mn", "mo", "mp", "mv", "my", "np", "ph", "pk", "sg",
    "th", "tl", "tw", "vn",
  ],
  OC: [
    "aq", "as", "au", "cc", "ck", "cx", "fj", "fm", "hm", "ki", "mh", "nc", "nf",
    "nr", "nu", "nz", "pf", "pg", "pn", "pw", "sb", "tk", "to", "tv", "vu", "wf",
    "ws",
  ],
};

const COUNTRY_TO_REGION: Record<string, PlayRegionId> = {};
for (const [region, codes] of Object.entries(REGION_COUNTRIES) as [PlayRegionId, readonly string[]][]) {
  for (const code of codes) COUNTRY_TO_REGION[code] = region;
}

/** Play region for an ISO country code, or null when unset / unknown. */
export function countryToPlayRegion(
  code: string | null | undefined
): PlayRegionId | null {
  if (!code) return null;
  return COUNTRY_TO_REGION[code.toLowerCase()] ?? null;
}

export function countriesInPlayRegion(region: PlayRegionId): readonly string[] {
  return REGION_COUNTRIES[region];
}

/** Dev guard: every flag we ship should map to a queue region. */
const unmapped = COUNTRY_CODES.filter((c) => !COUNTRY_TO_REGION[c]);
if (unmapped.length > 0) {
  console.warn("[country-regions] unmapped country codes:", unmapped.join(", "));
}
