"use client";

import { ReactNode } from "react";
import { Globe, Swords } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { RankTierLetter } from "@/types";
import { getRankByLetter } from "@/data/ranks";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";

function SkillLevelBox({
  rank,
  elo,
}: {
  rank?: RankTierLetter | null;
  elo?: number | null;
}) {
  const letter = rank ?? "UNRANKED";
  const color = getRankByLetter(letter).color;
  const hasSkill = !!rank && rank !== "UNRANKED" && elo != null && elo > 0;

  return (
    <div className="relative inline-flex items-center gap-4 rounded-xl border border-white/[0.1] bg-[#121212] pl-5 pr-6 py-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      {hasSkill && (
        <span
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{ boxShadow: `inset 0 0 28px ${color}32` }}
        />
      )}
      <span className="relative text-[12px] font-bold tracking-[0.18em] text-[#9a9a9a] uppercase whitespace-nowrap">
        Skill level
      </span>
      {hasSkill ? (
        <>
          <span className="relative flex items-center justify-center w-14 h-14 shrink-0">
            <span
              className="absolute inset-[-12px] rounded-full blur-[12px] pointer-events-none"
              style={{ backgroundColor: color, opacity: 0.85 }}
            />
            <RankBadge rank={letter} size="md" showGlow={false} className="relative !w-12 !h-12" />
          </span>
          <span className="relative text-[42px] leading-none font-black tabular-nums text-[#ff5500]">
            {elo}
          </span>
        </>
      ) : (
        <>
          <span className="relative flex items-center justify-center w-14 h-14 shrink-0">
            <RankBadge rank="UNRANKED" size="md" showGlow={false} className="relative !w-12 !h-12" />
          </span>
          <span className="relative text-[28px] leading-none font-black text-white">Unranked</span>
        </>
      )}
    </div>
  );
}

function GameChip() {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex items-center justify-center w-14 h-14 rounded-xl bg-[#ff5500] shadow-[0_0_22px_rgba(255,85,0,0.5)]">
        <Swords className="w-7 h-7 text-white" strokeWidth={2.25} />
      </span>
      <div className="leading-tight text-left">
        <div className="text-[17px] font-bold text-white">Strike Force</div>
        <div className="flex items-center gap-1.5 text-[12px] text-[#8a8a8a] mt-0.5">
          <Globe className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wide">{MATCH_MODE_LABEL}</span>
        </div>
      </div>
    </div>
  );
}

/** FACEIT hub game strip: large skill box centered, Strike Force on the right. */
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
  const hasSkill = !!rank && rank !== "UNRANKED" && elo != null && elo > 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#1a1a1a] ${className}`}
    >
      {hasSkill && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-32 rounded-full blur-3xl pointer-events-none"
          style={{ backgroundColor: color, opacity: 0.3 }}
        />
      )}

      {header && (
        <div className="relative flex items-start justify-between gap-3 px-6 pt-5">{header}</div>
      )}

      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 min-h-[168px] py-6">
        <div />
        <SkillLevelBox rank={rank} elo={elo} />
        <div className="flex justify-end">
          <GameChip />
        </div>
      </div>

      {footer && (
        <div className="relative flex flex-wrap items-center justify-end gap-4 px-6 pb-5 pt-1 border-t border-white/[0.06]">
          {footer}
        </div>
      )}
    </div>
  );
}
