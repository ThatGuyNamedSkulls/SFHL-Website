"use client";

import { RoundEvent } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RoundTimelineProps {
  rounds: RoundEvent[];
  teamAName: string;
  teamBName: string;
  className?: string;
}

const winConditionIcons: Record<string, string> = {
  elimination: "💀",
  defuse: "🔧",
  detonation: "💥",
  timeout: "⏱",
};

/**
 * Visual round-by-round timeline showing which team won each round.
 * Colored blocks (green for A, red for B) with win condition tooltips.
 */
export function RoundTimeline({
  rounds,
  teamAName,
  teamBName,
  className = "",
}: RoundTimelineProps) {
  // Determine half-time point (usually round 12 in a 13-max game)
  const halfTimeRound = 12;

  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        {rounds.map((round, idx) => {
          const isTeamA = round.winner === "A";

          return (
            <div key={round.roundNumber} className="flex items-center">
              {/* Half-time divider */}
              {round.roundNumber === halfTimeRound + 1 && (
                <div className="w-px h-8 bg-hl-gold/40 mx-1.5" />
              )}

              <Tooltip>
                <TooltipTrigger>
                  <div
                    className={`
                      w-6 h-6 rounded-sm flex items-center justify-center text-[9px] font-bold cursor-default
                      transition-all duration-200 hover:scale-125 hover:z-10
                      ${isTeamA
                        ? "bg-hl-green/20 text-hl-green border border-hl-green/30"
                        : "bg-hl-red/20 text-hl-red border border-hl-red/30"
                      }
                    `}
                  >
                    {round.roundNumber}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-hl-panel border-hl-border text-white text-xs">
                  <div className="space-y-1">
                    <div className="font-semibold">
                      Round {round.roundNumber} —{" "}
                      <span className={isTeamA ? "text-hl-green" : "text-hl-red"}>
                        {isTeamA ? teamAName : teamBName}
                      </span>
                    </div>
                    <div className="text-hl-muted">
                      {winConditionIcons[round.winCondition]}{" "}
                      {round.winCondition.charAt(0).toUpperCase() +
                        round.winCondition.slice(1)}
                    </div>
                    {round.highlight && (
                      <div className="text-hl-gold">⭐ {round.highlight}</div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
