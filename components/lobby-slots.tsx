"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/avatar-frame";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { flagPath, countryName } from "@/lib/countries";
import { RankTierLetter } from "@/types";
import { Plus, Search, Crown, BadgeCheck, CircleAlert } from "lucide-react";
import { formatUsername } from "@/lib/format";

export interface LobbyMember {
  username: string;
  discordUsername?: string | null;
  avatar?: string | null;
  rank?: RankTierLetter;
  leader?: boolean;
  country?: string | null;
  /** Equipped profile-card art, rendered as the slot background. */
  card?: string | null;
  /** Equipped avatar-frame art, rendered around the avatar. */
  frame?: string | null;
  /** The logged-in user — rendered in the raised center slot (FACEIT-style). */
  self?: boolean;
  /** Live guild-membership check: green badge (true), red badge (false). */
  verified?: boolean | null;
  /** False → this member blocks the queue; shows the warning on their slot. */
  canQueue?: boolean;
}

interface LobbySlotsProps {
  members: LobbyMember[];
  size?: number;
  /** href for the "find parties" action slot */
  findPartiesHref?: string;
}

/**
 * FACEIT-style 5-slot lobby row: tall portrait cards, your own card raised in
 * the center, teammates filling the slots around it, and the last free slot
 * doubling as "Find parties".
 */
export function LobbySlots({ members, size = 5, findPartiesHref = "/party-finder" }: LobbySlotsProps) {
  const center = Math.floor(size / 2);

  // Place yourself in the center, then teammates outward (left, right, …).
  const positions: (LobbyMember | undefined)[] = Array.from({ length: size });
  const rest = [...members];
  const selfIdx = rest.findIndex((m) => m.self);
  const selfMember = selfIdx >= 0 ? rest.splice(selfIdx, 1)[0] : rest.shift();
  if (selfMember) positions[center] = selfMember;
  const fillOrder: number[] = [];
  for (let d = 1; d < size; d++) {
    if (center - d >= 0) fillOrder.push(center - d);
    if (center + d < size) fillOrder.push(center + d);
  }
  for (const idx of fillOrder) {
    if (rest.length === 0) break;
    positions[idx] = rest.shift();
  }

  // 1v1 mode renders a single centered card instead of the 5-slot grid.
  const slotW = size === 1 ? "w-full max-w-[240px]" : "";

  return (
    <div
      className={
        size === 1
          ? "flex justify-center gap-3 items-center"
          : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-center"
      }
    >
      {positions.map((member, i) => {
        const isCenter = i === center;
        const isLast = i === size - 1 && size > 1;

        if (member) {
          return (
            <div
              key={i}
              className={`lobby-slot filled relative overflow-hidden flex flex-col items-center justify-center px-3 gap-3 rounded-xl ${slotW} ${isCenter
                  ? `py-10 border-hl-gold/60 shadow-[0_0_24px_rgba(255,85,0,0.12)] z-10 ${size > 1 ? "lg:-my-3" : ""}`
                  : "py-8"
                }`}
            >
              {/* Queue-requirement warning (FACEIT-style, floating on the slot) */}
              {member.canQueue === false && (
                <span
                  title="This player can't queue — not in the Discord server or not linked to a player."
                  className="absolute top-2 left-1/2 -translate-x-1/2 z-20"
                >
                  <CircleAlert className="w-4 h-4 text-[#f5c518]" />
                </span>
              )}
              {/* Equipped profile card as the slot background */}
              {member.card && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={member.card}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/55 to-hl-panel" />
                </div>
              )}
              <div className="relative z-10">
                <AvatarFrame frame={member.frame}>
                  <Avatar className={`border-2 border-hl-border shadow-xl ${isCenter ? "w-24 h-24" : "w-16 h-16"}`}>
                    {member.avatar ? <AvatarImage src={member.avatar} /> : null}
                    <AvatarFallback className="bg-hl-panel-light text-hl-gold font-bold">
                      {member.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </AvatarFrame>
                {member.leader && (
                  <Crown className="w-4 h-4 text-hl-gold absolute -top-1 -right-1 z-20" />
                )}
              </div>
              <div className="relative z-10 flex items-center gap-1.5 max-w-full">
                <span className="text-sm font-bold text-white truncate">{formatUsername(member.username, member.discordUsername)}</span>
                {member.verified !== null && member.verified !== undefined && (
                  <span title={member.verified ? "Verified — in the Discord server" : "Not verified — not in the Discord server"}>
                    <BadgeCheck className={`w-3.5 h-3.5 shrink-0 ${member.verified ? "text-hl-green" : "text-hl-red"}`} />
                  </span>
                )}
                {member.country && <Flag src={flagPath(member.country)} name={countryName(member.country)} className="w-4 h-3 shrink-0" />}
              </div>
              {/* Skill-level chip under the name, like FACEIT */}
              <div className="relative z-10 flex items-center justify-center rounded-full bg-hl-base/70 border border-hl-border px-2.5 py-1">
                <RankBadge rank={member.rank ?? "UNRANKED"} size="sm" showGlow={false} />
              </div>
            </div>
          );
        }

        // Last empty slot doubles as "find parties".
        if (isLast) {
          return (
            <Link
              key={i}
              href={findPartiesHref}
              className={`lobby-slot empty flex flex-col items-center justify-center py-8 px-3 gap-3 rounded-xl hover:border-hl-gold/40 transition-colors ${slotW}`}
            >
              <div className="w-16 h-16 rounded-full bg-hl-panel-light flex items-center justify-center">
                <Search className="w-6 h-6 text-hl-muted" />
              </div>
              <div className="text-xs text-hl-muted font-semibold">Find parties</div>
            </Link>
          );
        }

        return (
          <div key={i} className={`lobby-slot empty flex flex-col items-center justify-center py-8 px-3 gap-3 rounded-xl ${slotW}`}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center">
              <Plus className="w-8 h-8 text-hl-muted/60" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
