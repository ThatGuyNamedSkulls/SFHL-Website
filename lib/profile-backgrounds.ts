/** Default profile page backgrounds: color at the bottom fading to black at the top. */

export const DEFAULT_PROFILE_BACKGROUNDS = [
  { slug: "bg-red", name: "Red", color: "#e74c3c" },
  { slug: "bg-orange", name: "Orange", color: "#ff7a18" },
  { slug: "bg-yellow", name: "Yellow", color: "#f1c40f" },
  { slug: "bg-green", name: "Green", color: "#2ecc71" },
  { slug: "bg-blue", name: "Blue", color: "#3b82f6" },
  { slug: "bg-deep-blue", name: "Deep Blue", color: "#1e3a8a" },
  { slug: "bg-purple", name: "Purple", color: "#7c3aed" },
  { slug: "bg-lavender", name: "Lavender", color: "#c4b5fd" },
  { slug: "bg-mulberry", name: "Mulberry", color: "#9b2242" },
  { slug: "bg-white", name: "White", color: "#f5f5f5" },
] as const;

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isProfileBackgroundColor(value: string | null | undefined): value is string {
  return !!value && HEX.test(value.trim());
}

/** CSS gradient for shop / inventory swatches: equipped color at the bottom, black at the top. */
export function profileBackgroundImage(color: string | null | undefined): string | undefined {
  const hex = (color || "").trim();
  if (!HEX.test(hex)) return undefined;
  return `linear-gradient(to top, ${hex} 0%, #000000 100%)`;
}

/** WCAG relative luminance (0 = black, 1 = white) of a #rgb / #rrggbb color. */
export function luminance(hex: string): number {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * The profile page's tint (docs/PROFILE_UI_PLAN.md Q5): the equipped color at
 * the top of the page, fading out by ~460 px, instead of a full-page fade that
 * turned the lower page light grey with White, Lavender or Yellow. Lighter
 * colors get a weaker tint so grey text on top stays readable.
 */
export function profileBandImage(color: string | null | undefined): string | undefined {
  const hex = (color || "").trim();
  if (!HEX.test(hex)) return undefined;
  const l = luminance(hex);
  const top = l > 0.6 ? 14 : l > 0.35 ? 22 : 34;
  const mid = Math.round(top * 0.4);
  return `linear-gradient(180deg, color-mix(in srgb, ${hex} ${top}%, transparent) 0%, color-mix(in srgb, ${hex} ${mid}%, transparent) 46%, transparent 100%)`;
}
