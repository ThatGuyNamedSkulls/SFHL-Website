"use client";

import { MmAccessBadge } from "@/components/mm-access-badge";

/** Server-computed tier above Verified (lib/name-badge.ts). */
export type NameBadgeTier = "staff" | "top10";

const ICONS: Record<NameBadgeTier, { src: string; label: string }> = {
  staff: { src: "/badges/Moderation_pin.png", label: "Match Staff" },
  top10: { src: "/badgeicons/top10-current.png", label: "Top 10" },
};

/**
 * The one badge next to a name, highest wins: Mod Pin → Top 10 → Verified
 * (matchmaking access). Renders nothing when the player has none of them.
 */
export function NameBadge({
  tier,
  verified,
  className = "",
}: {
  tier?: NameBadgeTier | null;
  verified?: boolean | null;
  className?: string;
}) {
  if (tier) {
    const icon = ICONS[tier];
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon.src}
        alt={icon.label}
        title={icon.label}
        width={16}
        height={16}
        className={`inline-block h-4 w-4 shrink-0 align-middle object-contain ${className}`}
      />
    );
  }
  return verified ? <MmAccessBadge className={className} /> : null;
}
