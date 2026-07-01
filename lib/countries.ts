import { COUNTRY_CODES } from "@/data/country-codes";

/**
 * Country helpers. Names are resolved from ISO 3166-1 alpha-2 codes via
 * Intl.DisplayNames (available in Node 20+ and all supported browsers), so we
 * don't maintain a hand-written name table.
 */

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

const CODE_SET = new Set(COUNTRY_CODES);

/** True when we have a flag image for this code. */
export function isValidCountry(code: string | null | undefined): boolean {
  return !!code && CODE_SET.has(code.toLowerCase());
}

/** Human-readable country name for a code (e.g. "pt" → "Portugal"). */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return displayNames.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Public path to the flag image for a code, or null when unavailable. */
export function flagPath(code: string | null | undefined): string | null {
  if (!isValidCountry(code)) return null;
  return `/flags/${code!.toLowerCase()}.png`;
}

export interface CountryOption {
  code: string;
  name: string;
}

/** All selectable countries, sorted by display name. */
export function countryOptions(): CountryOption[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}
