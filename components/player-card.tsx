"use client";

import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { Player } from "@/types";

interface PlayerCardProps {
  player: Player;
  className?: string;
}

/**
 * Hero card displaying player avatar, rank badge,
 * current ELO, and peak ELO with a gradient background.
 */
export function PlayerCard({ player, className = "" }: PlayerCardProps) {
  return (
    <Card
      className={`
        relative overflow-hidden
        bg-hl-panel border-hl-border
        p-6 card-hover-glow
        ${className}
      `}
    >
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-hero-radial opacity-60 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-4">
        {/* Avatar */}
        <Avatar className="w-20 h-20 border-2 border-hl-border">
          <AvatarFallback
            className="bg-hl-panel-light text-xl font-bold text-hl-gold"
          >
            {player.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        {/* Username */}
        <h2 className="text-xl font-bold text-white">{player.username}</h2>

        {/* Rank Badge */}
        <RankBadge rank={player.rank} size="lg" />

        {/* ELO */}
        <div className="text-center">
          <div className="text-3xl stat-number text-hl-gold">{player.elo}</div>
          <div className="text-xs text-hl-muted header-caps mt-1">
            Current ELO
          </div>
        </div>

        {/* Peak ELO */}
        <div className="text-center">
          <div className="text-lg stat-number text-hl-muted">
            {player.peakElo}
          </div>
          <div className="text-xs text-hl-muted header-caps mt-0.5">
            Peak ELO
          </div>
        </div>

        {/* Region */}
        <div className="flex items-center gap-1.5 text-xs text-hl-muted">
          <span className="w-2 h-2 rounded-full bg-hl-teal" />
          {player.region} Region
        </div>

        {/* Joined */}
        <div className="text-xs text-hl-muted">
          Joined {new Date(player.joinedDate).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          })}
        </div>
      </div>
    </Card>
  );
}
