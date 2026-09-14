"use client";

import { RankBadge } from "@/components/rank-badge";
import { RankTierLetter } from "@/types";
import { cn } from "@/lib/utils";
import { RotateCcw, ChevronUp, ChevronDown, Check } from "lucide-react";

export interface PlacementGame {
  result: "W" | "L";
  map?: string;
  matchId?: number;
}

/** FACEIT-style placement stepper: W/L arrows under completed games, rank at the end. */
export function PlacementTrack({
  total,
  played,
  games,
  rank,
  ranked,
}: {
  total: number;
  played: number;
  games: PlacementGame[];
  rank?: RankTierLetter | null;
  ranked?: boolean;
}) {
  const slots = Math.max(1, total);
  const nodes = Array.from({ length: slots }, (_, i) => {
    const game = games[i] ?? null;
    const done = i < played || !!game;
    return { i, game, done, win: game?.result === "W" };
  });

  return (
    <div className="pt-2 pb-1">
      <div className="text-[11px] font-bold tracking-[0.18em] text-[#6a6a6a] uppercase mb-4">
        Season 1 placements
      </div>
      <div className="flex items-start overflow-x-auto pb-2">
        <div className="flex flex-col items-center shrink-0 w-12">
          <span className="w-9 h-9 rounded-full border border-white/15 bg-[#161616] flex items-center justify-center text-[#8a8a8a]">
            <RotateCcw className="w-4 h-4" />
          </span>
          <span className="mt-2 text-[10px] font-semibold text-[#8a8a8a]">Reset</span>
        </div>

        {nodes.map((n) => (
          <div key={n.i} className="flex items-start min-w-0">
            <span className="w-6 sm:w-10 h-px bg-white/10 mt-[18px]" />
            <div className="flex flex-col items-center shrink-0 w-12">
              <span
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center border",
                  n.done
                    ? "bg-[#1c1c1c] border-white/20 text-white"
                    : "bg-transparent border-dashed border-white/15 text-[#6a6a6a]"
                )}
              >
                {n.done ? <Check className="w-4 h-4" /> : null}
              </span>
              <span className="mt-2 text-[11px] font-semibold text-[#c8c8c8]">{n.i + 1}</span>
              {n.done && n.game ? (
                n.win ? (
                  <ChevronUp className="w-4 h-4 text-[#2ecc71] mt-0.5" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#e74c3c] mt-0.5" />
                )
              ) : (
                <span className="h-4 mt-0.5" />
              )}
            </div>
          </div>
        ))}

        <div className="flex items-start min-w-0">
          <span className="w-6 sm:w-10 h-px bg-white/10 mt-[18px]" />
          <div className="flex flex-col items-center shrink-0 w-14">
        {ranked && rank && rank !== "UNRANKED" ? (
          <RankBadge rank={rank} size="sm" showGlow className="!w-9 !h-9" />
        ) : (
              <span className="w-9 h-9 rounded-full border border-dashed border-white/15 bg-[#161616] flex items-center justify-center text-[#6a6a6a] text-sm font-bold">
                ?
              </span>
            )}
            <span className="mt-2 text-[10px] font-semibold text-[#8a8a8a]">Rank</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlacementDots({
  games,
}: {
  games: { result: "W" | "L" }[];
}) {
  if (!games.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {games.map((g, i) => (
        <span
          key={i}
          className={cn(
            "w-2.5 h-2.5 rounded-full",
            g.result === "W" ? "bg-[#2ecc71]" : "bg-[#e74c3c]"
          )}
        />
      ))}
    </div>
  );
}
