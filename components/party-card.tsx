"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { PartyView, PartyMemberView, RankTierLetter } from "@/types";
import { getRankForElo } from "@/data/ranks";
import { flagPath, countryName } from "@/lib/countries";
import { Crown, Plus, Globe, Gamepad2, Mic, ShieldCheck, Users } from "lucide-react";

interface PartyCardProps {
  party: PartyView;
  currentUserId?: string;
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
  busy?: boolean;
}

/** Average skill tier of the party, derived from member ELOs. */
function avgRank(party: PartyView): RankTierLetter {
  const elos = party.members.map((m) => m.elo).filter((e) => e > 0);
  if (elos.length === 0) return "UNRANKED";
  const avg = elos.reduce((a, b) => a + b, 0) / elos.length;
  return getRankForElo(avg).letter;
}

function MemberSlot({ member, isLeader }: { member: PartyMemberView; isLeader: boolean }) {
  const rank = (member.rank || "UNRANKED") as RankTierLetter;
  return (
    <div className="lobby-slot filled flex flex-col items-center justify-center py-4 px-2 gap-2 min-h-[150px]">
      <div className="relative">
        <Avatar className="w-14 h-14 border-2 border-hl-gold/30">
          {member.avatar ? <AvatarImage src={member.avatar} /> : null}
          <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
            {member.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {isLeader && <Crown className="w-4 h-4 text-hl-gold absolute -top-1.5 -right-1.5" />}
      </div>
      <div className="flex items-center gap-1 max-w-full">
        <span className="text-xs font-bold text-white truncate">{member.username}</span>
        {member.country && <Flag src={flagPath(member.country)} name={countryName(member.country)} className="w-4 h-3 shrink-0" />}
      </div>
      <div className="flex items-center gap-1.5">
        <RankBadge rank={rank} size="sm" />
        {member.elo > 0 && <span className="text-xs text-hl-muted stat-number">{member.elo}</span>}
      </div>
    </div>
  );
}

export function PartyCard({ party, currentUserId, onJoin, onLeave, busy }: PartyCardProps) {
  const inParty = !!currentUserId && party.members.some((m) => m.discordId === currentUserId);
  const full = party.members.length >= party.maxSize;
  const emptySlots = Math.max(0, party.maxSize - party.members.length);

  return (
    <div className="party-card p-4">
      {/* Avg skill level badge */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-white truncate flex items-center gap-2">
          <Users className="w-4 h-4 text-hl-muted" /> {party.name}
        </h3>
        <span className="flex items-center gap-1.5 text-[10px] header-caps text-hl-muted border border-hl-border rounded-full pl-1.5 pr-2 py-0.5">
          <RankBadge rank={avgRank(party)} size="sm" className="!w-5 !h-5" />
          Avg Skill
        </span>
      </div>

      {/* 5-slot row */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {party.members.map((m) => (
          <MemberSlot key={m.discordId} member={m} isLeader={m.discordId === party.leaderId} />
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div
            key={`e${i}`}
            className="lobby-slot empty flex items-center justify-center min-h-[150px]"
          >
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-hl-border flex items-center justify-center">
              <Plus className="w-5 h-5 text-hl-muted" />
            </div>
          </div>
        ))}
      </div>

      {/* Footer: tags + join/leave */}
      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-hl-border">
        <span className="flex items-center gap-1 text-[11px] text-hl-muted">
          <Gamepad2 className="w-3.5 h-3.5" /> {party.game}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-hl-muted">
          <Globe className="w-3.5 h-3.5" /> {party.region}
        </span>
        <span className="text-[11px] text-hl-gold font-semibold">{party.matchType}</span>
        <span className="text-[11px] text-hl-muted">{party.gameMode}</span>
        {party.voiceRequired && (
          <span className="flex items-center gap-1 text-[11px] text-hl-muted">
            <Mic className="w-3.5 h-3.5" /> Voice
          </span>
        )}
        {party.verifiedOnly && (
          <span className="flex items-center gap-1 text-[11px] text-hl-teal">
            <ShieldCheck className="w-3.5 h-3.5" /> Verified
          </span>
        )}
        <span className="text-[11px] text-hl-muted">{party.language}</span>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-hl-muted">{party.members.length}/{party.maxSize}</span>
          {inParty ? (
            <button
              onClick={() => onLeave?.(party.id)}
              disabled={busy}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20 transition-colors disabled:opacity-50"
            >
              Leave
            </button>
          ) : (
            <button
              onClick={() => onJoin?.(party.id)}
              disabled={busy || full}
              className="text-xs font-bold px-5 py-2 rounded-lg bg-gold-gradient text-hl-base hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {full ? "Full" : "Join"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
