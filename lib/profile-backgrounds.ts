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

/** CSS gradient: equipped color at the bottom, black at the top. */
export function profileBackgroundImage(color: string | null | undefined): string | undefined {
  const hex = (color || "").trim();
  if (!HEX.test(hex)) return undefined;
  return `linear-gradient(to top, ${hex} 0%, #000000 100%)`;
}
