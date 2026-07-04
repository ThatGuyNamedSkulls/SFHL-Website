"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/avatar-frame";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { PartyView, PartyMemberView, RankTierLetter } from "@/types";
import { getRankForElo, getRankByLetter } from "@/data/ranks";
import { flagPath, countryName } from "@/lib/countries";
import {
  Crown,
  Plus,
  Globe,
  Gamepad2,
  Mic,
  ShieldCheck,
  Users,
  Lock,
  UserPlus,
  Swords,
  Languages,
  Sparkles,
  BadgeCheck,
  CircleAlert,
} from "lucide-react";

export interface FriendOption {
  name: string;
  avatar: string | null;
}

interface PartyCardProps {
  party: PartyView;
  currentUserId?: string;
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
  /** Friends the current user can invite (party-finder supplies these). */
  friends?: FriendOption[];
  onInvite?: (partyId: string, friendName: string) => void;
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
    <div className="lobby-slot filled relative overflow-hidden flex flex-col items-center justify-center py-4 px-2 gap-2 min-h-[160px] rounded-xl">
      {/* Queue-requirement warning */}
      {member.canQueue === false && (
        <span
          title="This player can't queue — not in the Discord server or not linked to a player."
          className="absolute top-1.5 left-1/2 -translate-x-1/2 z-20"
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
      {isLeader && <Crown className="relative z-10 w-4 h-4 text-hl-gold -mb-1" />}
      <div className="relative z-10">
        <AvatarFrame frame={member.frame}>
          <Avatar className="w-14 h-14 border-2 border-hl-border">
            {member.avatar ? <AvatarImage src={member.avatar} /> : null}
            <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
              {member.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </AvatarFrame>
      </div>
      <div className="relative z-10 flex items-center gap-1 max-w-full">
        <span className="text-xs font-bold text-white truncate">{member.username}</span>
        {member.verified !== null && member.verified !== undefined && (
          <span title={member.verified ? "Verified — in the Discord server" : "Not verified — not in the Discord server"}>
            <BadgeCheck className={`w-3.5 h-3.5 shrink-0 ${member.verified ? "text-hl-green" : "text-hl-red"}`} />
          </span>
        )}
        {member.country && <Flag src={flagPath(member.country)} name={countryName(member.country)} className="w-4 h-3 shrink-0" />}
      </div>
      <div className="relative z-10 flex items-center gap-1.5">
        <RankBadge rank={rank} size="sm" showGlow={false} className="!w-6 !h-6" />
        <span className="text-xs text-hl-muted stat-number">
          {member.elo > 0 ? member.elo.toLocaleString() : "Unranked"}
        </span>
      </div>
    </div>
  );
}

const CHIP_CLS =
  "inline-flex items-center gap-1 rounded-md bg-hl-panel-light/60 border border-hl-border/60 px-2 py-1 text-[11px] text-hl-muted";

export function PartyCard({ party, currentUserId, onJoin, onLeave, friends, onInvite, busy }: PartyCardProps) {
  const inParty = !!currentUserId && party.members.some((m) => m.discordId === currentUserId);
  const full = party.members.length >= party.maxSize;
  const emptySlots = Math.max(0, party.maxSize - party.members.length);
  const [inviteOpen, setInviteOpen] = useState(false);

  const avg = avgRank(party);
  const avgColor = getRankByLetter(avg).color;

  // Friends not already in this party — the invitable set.
  const invitable = (friends ?? []).filter(
    (f) => !party.members.some((m) => m.playerName === f.name)
  );

  return (
    <div className="party-card relative p-4 pt-5">
      {/* Avg skill level chip, floating on the card edge (FACEIT-style) */}
      <span
        className="absolute -top-3 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-hl-base px-2 py-0.5 text-[10px] header-caps text-white border"
        style={{ borderColor: avgColor }}
      >
        <RankBadge rank={avg} size="sm" showGlow={false} className="!w-4 !h-4" />
        Avg Skill Level
      </span>

      {/* Member slots */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {party.members.map((m) => (
          <MemberSlot key={m.discordId} member={m} isLeader={m.discordId === party.leaderId} />
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <button
            key={`e${i}`}
            onClick={() => !inParty && !busy && onJoin?.(party.id)}
            disabled={inParty || busy}
            className="lobby-slot empty flex items-center justify-center min-h-[160px] rounded-xl hover:border-hl-gold/40 transition-colors disabled:cursor-default"
            title={inParty ? "Open slot" : "Join this party"}
          >
            <Plus className="w-8 h-8 text-hl-muted/60" />
          </button>
        ))}
      </div>

      {/* Footer: chips + actions */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-hl-border">
        <span className={`${CHIP_CLS} !text-white font-bold`}>
          <Users className="w-3 h-3" /> {party.name}
          {party.isPrivate && <Lock className="w-3 h-3 text-hl-gold" />}
        </span>
        <span className={CHIP_CLS}><Gamepad2 className="w-3 h-3" /> {party.game}</span>
        <span className={CHIP_CLS}><Globe className="w-3 h-3" /> {party.region}</span>
        <span className={`${CHIP_CLS} !text-hl-gold`}><Swords className="w-3 h-3" /> {party.matchType} · {party.gameMode}</span>
        <span className={CHIP_CLS}>
          <RankBadge rank={party.minSkill as RankTierLetter} size="sm" showGlow={false} className="!w-4 !h-4" />
          –
          <RankBadge rank={party.maxSkill as RankTierLetter} size="sm" showGlow={false} className="!w-4 !h-4" />
        </span>
        {party.vibe && <span className={CHIP_CLS}><Sparkles className="w-3 h-3 text-hl-gold" /> {party.vibe}</span>}
        {party.language !== "Any" && <span className={CHIP_CLS}><Languages className="w-3 h-3" /> {party.language}</span>}
        {party.countries !== "Any" && <span className={CHIP_CLS}><Globe className="w-3 h-3" /> {party.countries}</span>}
        {party.voiceRequired && <span className={CHIP_CLS}><Mic className="w-3 h-3" /> Voice</span>}
        {party.verifiedOnly && <span className={`${CHIP_CLS} !text-hl-teal`}><ShieldCheck className="w-3 h-3" /> Verified</span>}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-hl-muted">{party.members.length}/{party.maxSize}</span>
          {inParty && onInvite && !full && (
            <div className="relative">
              <button
                onClick={() => setInviteOpen((o) => !o)}
                className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-hl-border text-white hover:bg-hl-panel-light transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" /> Invite
              </button>
              {inviteOpen && (
                <div className="absolute right-0 bottom-full mb-2 w-56 max-h-64 overflow-y-auto rounded-lg border border-hl-border bg-hl-panel shadow-xl z-20 py-1">
                  {invitable.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-hl-muted">
                      {(friends ?? []).length === 0 ? "No friends to invite yet." : "All friends are in the party."}
                    </div>
                  ) : (
                    invitable.map((f) => {
                      const invited = (party.invitedNames ?? []).includes(f.name);
                      return (
                        <button
                          key={f.name}
                          disabled={invited}
                          onClick={() => {
                            if (invited) return;
                            onInvite(party.id, f.name);
                            setInviteOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm ${
                            invited ? "text-hl-muted cursor-default" : "text-white hover:bg-hl-panel-light/60"
                          }`}
                        >
                          <Avatar className="w-6 h-6 border border-hl-border">
                            {f.avatar ? <AvatarImage src={f.avatar} /> : null}
                            <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                              {f.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate flex-1">{f.name}</span>
                          {invited && <span className="text-[10px] text-hl-muted shrink-0">Invited</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
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
