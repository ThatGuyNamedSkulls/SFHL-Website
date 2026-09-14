"use client";

import { ReactNode } from "react";
import { Globe, Swords } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { RankTierLetter } from "@/types";
import { getRankByLetter } from "@/data/ranks";

function SkillLevelBox({
  rank,
  elo,
}: {
  rank?: RankTierLetter | null;
  elo?: number | null;
}) {
  const letter = rank ?? "UNRANKED";
  const color = getRankByLetter(letter).color;
  const hasSkill = rank != null && elo != null;

  if (!hasSkill) {
    return (
      <div className="inline-flex items-center gap-3 rounded-lg border border-white/[0.08] bg-[#141414] px-3.5 py-2">
        <span className="text-[10px] font-bold tracking-[0.16em] text-[#7a7a7a] uppercase">
          Skill level
        </span>
        <span className="text-sm font-bold text-white">Unranked</span>
      </div>
    );
  }

  return (
    <div className="relative inline-flex items-center gap-3 rounded-lg border border-white/[0.07] bg-[#141414] pl-3.5 pr-3.5 py-2">
      <span
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{ boxShadow: `inset 0 0 22px ${color}28` }}
      />
      <span className="relative text-[10px] font-bold tracking-[0.16em] text-[#7a7a7a] uppercase whitespace-nowrap">
        Skill level
      </span>
      <span className="relative flex items-center justify-center w-9 h-9">
        <span
          className="absolute inset-[-8px] rounded-full blur-[10px] pointer-events-none"
          style={{ backgroundColor: color, opacity: 0.8 }}
        />
        <RankBadge rank={letter} size="sm" showGlow={false} className="relative !w-8 !h-8" />
      </span>
      <span className="relative text-[24px] leading-none font-black tabular-nums text-[#ff5500]">
        {elo}
      </span>
    </div>
  );
}

function GameChip() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-11 h-11 rounded-[10px] bg-[#ff5500] shadow-[0_0_18px_rgba(255,85,0,0.45)]">
        <Swords className="w-[22px] h-[22px] text-white" strokeWidth={2.25} />
      </span>
      <div className="leading-tight text-left">
        <div className="text-[15px] font-bold text-white">Strike Force</div>
        <div className="flex items-center gap-1 text-[11px] text-[#8a8a8a] mt-0.5">
          <Globe className="w-3 h-3" />
          <span className="uppercase tracking-wide">5v5</span>
        </div>
      </div>
    </div>
  );
}

/** FACEIT hub game strip: compact skill box centered, Strike Force 5v5 on the right. */
export function GameSkillBar({
  rank,
  elo,
  className = "",
  header,
  footer,
}: {
  rank?: RankTierLetter | null;
  elo?: number | null;
  className?: string;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const letter = rank ?? "UNRANKED";
  const color = getRankByLetter(letter).color;
  const hasSkill = rank != null && elo != null;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#1a1a1a] ${className}`}
    >
      {hasSkill && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-24 rounded-full blur-3xl pointer-events-none"
          style={{ backgroundColor: color, opacity: 0.26 }}
        />
      )}

      {header && (
        <div className="relative flex items-start justify-between gap-3 px-5 pt-5">{header}</div>
      )}

      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 min-h-[132px] py-5">
        <div />
        <SkillLevelBox rank={rank} elo={elo} />
        <div className="flex justify-end">
          <GameChip />
        </div>
      </div>

      {footer && (
        <div className="relative flex flex-wrap items-center justify-end gap-4 px-5 pb-5 pt-1 border-t border-white/[0.06]">
          {footer}
        </div>
      )}
    </div>
  );
}
