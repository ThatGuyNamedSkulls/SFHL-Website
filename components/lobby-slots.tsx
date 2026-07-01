"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { flagPath, countryName } from "@/lib/countries";
import { RankTierLetter } from "@/types";
import { Plus, Search, Crown } from "lucide-react";

export interface LobbyMember {
  username: string;
  avatar?: string | null;
  rank?: RankTierLetter;
  leader?: boolean;
  country?: string | null;
}

interface LobbySlotsProps {
  members: LobbyMember[];
  size?: number;
  /** href for the "find parties" action slot */
  findPartiesHref?: string;
}

/** 5-player lobby card row used on the matchmaking page. */
export function LobbySlots({ members, size = 5, findPartiesHref = "/party-finder" }: LobbySlotsProps) {
  const slots = Array.from({ length: size });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {slots.map((_, i) => {
        const member = members[i];
        const isLast = i === size - 1;

        if (member) {
          return (
            <div key={i} className="lobby-slot filled flex flex-col items-center justify-center py-6 px-3 gap-3">
              <div className="relative">
                <Avatar className="w-16 h-16 border-2 border-hl-gold/40">
                  {member.avatar ? <AvatarImage src={member.avatar} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-hl-gold font-bold">
                    {member.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {member.leader && (
                  <Crown className="w-4 h-4 text-hl-gold absolute -top-1 -right-1" />
                )}
              </div>
              <div className="flex items-center gap-1.5 max-w-full">
                <span className="text-sm font-bold text-white truncate">{member.username}</span>
                {member.country && <Flag src={flagPath(member.country)} name={countryName(member.country)} className="w-4 h-3 shrink-0" />}
              </div>
              {member.rank && <RankBadge rank={member.rank} size="sm" />}
            </div>
          );
        }

        // Last empty slot doubles as "find parties".
        if (isLast) {
          return (
            <Link
              key={i}
              href={findPartiesHref}
              className="lobby-slot empty flex flex-col items-center justify-center py-6 px-3 gap-3 hover:border-hl-gold/40 transition-colors"
            >
              <div className="w-16 h-16 rounded-full bg-hl-panel-light flex items-center justify-center">
                <Search className="w-6 h-6 text-hl-muted" />
              </div>
              <div className="text-xs text-hl-muted font-semibold">Find parties</div>
            </Link>
          );
        }

        return (
          <div key={i} className="lobby-slot empty flex flex-col items-center justify-center py-6 px-3 gap-3">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-hl-border flex items-center justify-center">
              <Plus className="w-6 h-6 text-hl-muted" />
            </div>
            <div className="text-xs text-hl-muted">Empty</div>
          </div>
        );
      })}
    </div>
  );
}
