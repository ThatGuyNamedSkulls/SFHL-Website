"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bracket, BracketMatch } from "@/types";
import { Flame, Trophy } from "lucide-react";

interface BracketViewProps {
  bracket: Bracket;
  className?: string;
}

/** Single match card within the bracket */
function BracketMatchCard({ match }: { match: BracketMatch }) {
  const isLive = match.status === "live";
  const isCompleted = match.status === "completed";

  return (
    <div
      className={`
        relative w-[220px] rounded-lg border overflow-hidden
        transition-all duration-300
        ${isLive
          ? "border-hl-red/50 bg-hl-panel shadow-[0_0_15px_rgba(255,83,83,0.15)]"
          : "border-hl-border bg-hl-panel hover:border-hl-gold/30"
        }
      `}
    >
      {/* LIVE badge */}
      {isLive && (
        <div className="absolute top-0 right-0 px-2 py-0.5 bg-hl-red text-white text-[10px] font-bold rounded-bl-lg flex items-center gap-1">
          <Flame className="w-2.5 h-2.5" /> LIVE
        </div>
      )}

      {/* Team A */}
      <div
        className={`
          flex items-center justify-between px-3 py-2 border-b border-hl-border/50
          ${isCompleted && match.winner === match.teamA ? "bg-hl-green/5" : ""}
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isCompleted && match.winner === match.teamA && (
            <Trophy className="w-3 h-3 text-hl-gold flex-shrink-0" />
          )}
          <span
            className={`text-xs font-medium truncate ${
              match.teamA
                ? isCompleted && match.winner === match.teamA
                  ? "text-hl-gold"
                  : "text-white"
                : "text-hl-muted italic"
            }`}
          >
            {match.teamA || "TBD"}
          </span>
        </div>
        <span
          className={`text-xs font-mono font-bold ml-2 ${
            isCompleted && match.winner === match.teamA
              ? "text-hl-gold"
              : "text-hl-muted"
          }`}
        >
          {match.scoreA ?? "-"}
        </span>
      </div>

      {/* Team B */}
      <div
        className={`
          flex items-center justify-between px-3 py-2
          ${isCompleted && match.winner === match.teamB ? "bg-hl-green/5" : ""}
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isCompleted && match.winner === match.teamB && (
            <Trophy className="w-3 h-3 text-hl-gold flex-shrink-0" />
          )}
          <span
            className={`text-xs font-medium truncate ${
              match.teamB
                ? isCompleted && match.winner === match.teamB
                  ? "text-hl-gold"
                  : "text-white"
                : "text-hl-muted italic"
            }`}
          >
            {match.teamB || "TBD"}
          </span>
        </div>
        <span
          className={`text-xs font-mono font-bold ml-2 ${
            isCompleted && match.winner === match.teamB
              ? "text-hl-gold"
              : "text-hl-muted"
          }`}
        >
          {match.scoreB ?? "-"}
        </span>
      </div>

      {/* Map tag */}
      {match.map && (
        <div className="px-3 py-1 border-t border-hl-border/50 bg-hl-base/30">
          <span className="text-[10px] text-hl-muted">{match.map}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Tournament bracket visualization — renders a horizontal bracket
 * with lines connecting matches from round to round.
 */
export function BracketView({ bracket, className = "" }: BracketViewProps) {
  const maxMatchesInRound = Math.max(
    ...bracket.rounds.map((r) => r.matches.length)
  );

  return (
    <div className={`overflow-x-auto ${className}`}>
      <div className="inline-flex items-start gap-0 min-w-max p-4">
        {bracket.rounds.map((round, roundIdx) => {
          const matchHeight = 88; // approx height of each match card
          const gap = Math.pow(2, roundIdx) * matchHeight;

          return (
            <div key={round.name} className="flex items-start">
              {/* Round column */}
              <div className="flex flex-col items-center">
                {/* Round label */}
                <div className="mb-4 text-center">
                  <span className="text-xs header-caps text-hl-muted">
                    {round.name}
                  </span>
                </div>

                {/* Matches */}
                <div
                  className="flex flex-col justify-around"
                  style={{
                    gap: `${gap - matchHeight}px`,
                    minHeight: `${maxMatchesInRound * gap}px`,
                  }}
                >
                  {round.matches.map((match) => (
                    <BracketMatchCard key={match.id} match={match} />
                  ))}
                </div>
              </div>

              {/* Connector lines between rounds */}
              {roundIdx < bracket.rounds.length - 1 && (
                <div className="flex flex-col justify-around w-10 relative" style={{ minHeight: `${maxMatchesInRound * gap}px` }}>
                  {round.matches.map((_, matchIdx) => {
                    if (matchIdx % 2 !== 0) return null;
                    const pairGap = gap;
                    const connectorTop = matchIdx * gap + matchHeight / 2;
                    const connectorBottom = (matchIdx + 1) * gap + matchHeight / 2;
                    const midY = (connectorTop + connectorBottom) / 2;

                    return (
                      <svg
                        key={matchIdx}
                        className="absolute left-0 w-10 overflow-visible"
                        style={{
                          top: connectorTop,
                          height: connectorBottom - connectorTop,
                        }}
                      >
                        {/* Top line out */}
                        <line
                          x1="0" y1="0"
                          x2="16" y2="0"
                          stroke="#27201F" strokeWidth="1.5"
                        />
                        {/* Vertical connector */}
                        <line
                          x1="16" y1="0"
                          x2="16" y2={connectorBottom - connectorTop}
                          stroke="#27201F" strokeWidth="1.5"
                        />
                        {/* Bottom line out */}
                        <line
                          x1="0" y1={connectorBottom - connectorTop}
                          x2="16" y2={connectorBottom - connectorTop}
                          stroke="#27201F" strokeWidth="1.5"
                        />
                        {/* Middle line to next round */}
                        <line
                          x1="16" y1={(connectorBottom - connectorTop) / 2}
                          x2="40" y2={(connectorBottom - connectorTop) / 2}
                          stroke="#27201F" strokeWidth="1.5"
                        />
                      </svg>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
