"use client";

import { useState } from "react";
import { MmAccessBadge } from "@/components/mm-access-badge";
import { optimizedAsset } from "@/lib/optimized-asset";
import type { NameBadgeValue } from "@/types";

/** Server-computed badge in place of Verified (lib/name-badge.ts). */
export type { NameBadgeValue };

const ICONS: Record<"staff" | "top10", { src: string; label: string }> = {
  staff: { src: "/badges/Moderation_pin.png", label: "Match Staff" },
  top10: { src: "/badgeicons/top10-current.png", label: "Top 10" },
};

/** Badge box per spot, matched to the name beside it (about its line height). */
const SIZES = {
  sm: { px: 18, box: "h-[18px] w-[18px]" }, // party cards: text-xs names
  md: { px: 20, box: "h-5 w-5" },           // lobby slots: text-sm names
  lg: { px: 28, box: "h-7 w-7" },           // profile header: text-xl name
} as const;

export type NameBadgeSize = keyof typeof SIZES;

/**
 * The one badge next to a name, highest wins: Mod Pin → Top 10 → the first
 * badge the player equipped → Verified (matchmaking access). An equipped badge
 * whose image is missing or fails to load falls back to Verified. Renders
 * nothing when the player has none of them.
 */
export function NameBadge({
  badge,
  verified,
  size = "md",
  className = "",
}: {
  badge?: NameBadgeValue | null;
  verified?: boolean | null;
  size?: NameBadgeSize;
  className?: string;
}) {
  const { px, box } = SIZES[size];
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  let icon: { src: string; label: string } | null = null;
  if (typeof badge === "string") {
    icon = ICONS[badge];
  } else if (badge?.asset) {
    const src = optimizedAsset(badge.asset);
    if (src !== brokenSrc) icon = { src, label: badge.name };
  }
  if (icon) {
    const equipped = typeof badge === "object";
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon.src}
        alt={icon.label}
        title={icon.label}
        width={px}
        height={px}
        onError={equipped ? () => setBrokenSrc(icon.src) : undefined}
        className={`inline-block ${box} shrink-0 align-middle object-contain ${className}`}
      />
    );
  }
  return verified ? <MmAccessBadge className={`${box} ${className}`} /> : null;
}
