"use client";

import { RankTierLetter } from "@/types";
import { RANK_TIERS } from "@/data/ranks";

/** Tiers that have a real icon in /public/ranks. STAR/UNRANKED fall back to a letter badge. */
const ICON_TIERS: RankTierLetter[] = [
  "D", "C", "B", "A1", "A2", "A3", "S1", "S2", "S3",
];

function iconSrc(rank: RankTierLetter): string | null {
  return ICON_TIERS.includes(rank) ? `/ranks/${rank.toLowerCase()}.png` : null;
}

interface RankBadgeProps {
  rank: RankTierLetter;
  size?: "sm" | "md" | "lg";
  showGlow?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-base",
  lg: "w-16 h-16 text-xl",
};

/**
 * Rank badge — shows the real tier icon when available (D…S3), otherwise a
 * color-coded letter badge (STAR, Unranked), with an optional glow.
 */
export function RankBadge({ rank, size = "md", showGlow = true, className = "" }: RankBadgeProps) {
  const tier = RANK_TIERS.find((t) => t.letter === rank) ?? RANK_TIERS[0];
  const src = iconSrc(rank);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`Tier ${tier.name}`}
        title={`${tier.name} (${tier.dbName})`}
        className={`${SIZE_CLASSES[size]} object-contain select-none ${
          showGlow ? tier.glowClass : ""
        } ${className}`}
      />
    );
  }

  const displayLabel = rank === "STAR" ? "★" : rank === "UNRANKED" ? "?" : rank;
  return (
    <div
      className={`
        ${SIZE_CLASSES[size]}
        rounded-full flex items-center justify-center
        font-bold border-2 select-none
        transition-all duration-300
        ${showGlow ? tier.glowClass : ""}
        ${className}
      `}
      style={{
        borderColor: tier.color,
        color: tier.color,
        backgroundColor: `${tier.color}15`,
      }}
      title={`${tier.name} (${tier.dbName})`}
    >
      {displayLabel}
    </div>
  );
}

/** Small inline rank badge for use in tables/lists. */
export function RankBadgeInline({ rank }: { rank: RankTierLetter }) {
  const tier = RANK_TIERS.find((t) => t.letter === rank) ?? RANK_TIERS[0];
  const src = iconSrc(rank);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`Tier ${tier.name}`}
        title={`${tier.name} (${tier.dbName})`}
        className="inline-block w-6 h-6 object-contain align-middle select-none"
      />
    );
  }

  const displayLabel = rank === "STAR" ? "★" : rank === "UNRANKED" ? "?" : rank;
  return (
    <span
      className="inline-flex items-center justify-center min-w-[1.75rem] h-6 rounded-full text-[10px] font-bold border px-1"
      style={{
        borderColor: tier.color,
        color: tier.color,
        backgroundColor: `${tier.color}15`,
      }}
      title={`${tier.name} (${tier.dbName})`}
    >
      {displayLabel}
    </span>
  );
}
