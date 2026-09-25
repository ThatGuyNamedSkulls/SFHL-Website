/**
 * Small pre-made copies of heavy public images (docs/PERFORMANCE_PLAN.md step 2):
 * "/ranks/a1.png" → "/_opt/ranks/a1.webp". The copies and the manifest are
 * written by scripts/optimize-images.mjs; anything not in the manifest (remote
 * URLs, new cosmetics before the script is re-run) is returned unchanged.
 * Pure, so client and server components can both use it.
 */
import manifest from "@/lib/optimized-assets.json";

const MAP = manifest as Record<string, string>;

export function optimizedAsset(src: string): string;
export function optimizedAsset(src: string | null | undefined): string | null;
export function optimizedAsset(src: string | null | undefined): string | null {
  if (!src) return null;
  return MAP[src] ?? src;
}
