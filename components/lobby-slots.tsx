"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AvatarFrame } from "@/components/avatar-frame";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { flagPath, countryName } from "@/lib/countries";
import { getRankByLetter } from "@/data/ranks";
import { rankRing } from "@/lib/player-card";
import { RankTierLetter } from "@/types";
import { Plus, Search, Crown, BadgeCheck, CircleAlert, UserRound } from "lucide-react";
import { MmAccessBadge } from "@/components/mm-access-badge";

export interface LobbyMember {
  username: string;
  discordUsername?: string | null;
  avatar?: string | null;
  rank?: RankTierLetter;
  /** Main Elo, for the rank ring and the Elo line (unknown → the ring is just the rank colour). */
  elo?: number | null;
  leader?: boolean;
  country?: string | null;
  /** Equipped profile-card art, rendered as the card's banner. */
  card?: string | null;
  /** Equipped avatar-frame art, rendered around the avatar. */
  frame?: string | null;
  /** The logged-in user — rendered in the raised center slot (FACEIT-style). */
  self?: boolean;
  /** Live guild-membership check: green badge (true), red badge (false). */
  verified?: boolean | null;
  /** Get Matchmaking Access Discord role. */
  mmAccess?: boolean | null;
  /** False → this member blocks the queue; shows the warning on their slot. */
  canQueue?: boolean;
  clubTag?: string | null;
}

interface LobbySlotsProps {
  members: LobbyMember[];
  size?: number;
  /** href for the "find parties" action slot */
  findPartiesHref?: string;
}

/** The avatar ring: the rank's colour, filled by progress through the rank (same as the league player cards). */
function ring(m: LobbyMember): { color: string; progress: number } {
  const rank = m.rank ?? "UNRANKED";
  if (typeof m.elo === "number" && m.elo > 0 && rank !== "UNRANKED") {
    const r = rankRing(m.elo);
    return { color: r.color, progress: r.progress };
  }
  return { color: getRankByLetter(rank).color, progress: rank === "UNRANKED" ? 0 : 1 };
}

function LobbyCard({ member, center }: { member: LobbyMember; center: boolean }) {
  const r = ring(member);
  const rank = member.rank ?? "UNRANKED";
  const avatarPx = center ? 92 : 78;
  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-xl border bg-[#141414] ${
        center ? "border-[#ff5500]/70 shadow-[0_0_28px_rgba(255,85,0,0.15)]" : "border-white/[0.1]"
      }`}
    >
      {/* Banner: the equipped profile card, or a plain gradient. */}
      <div className={`relative w-full shrink-0 overflow-hidden ${center ? "h-[92px]" : "h-[80px]"}`}>
        {member.card ? (
          // eslint-disable-next-line @next/next/no-img-element -- cosmetic asset
          <img
            src={member.card}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,#262626,#161616)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#141414]" />
        {member.self ? (
          <span className="absolute left-2 top-2 rounded bg-[#ff5500] px-1.5 text-[9px] font-black leading-4 text-white">YOU</span>
        ) : null}
        {member.canQueue === false ? (
          <span
            title="This player can't queue — not in the Discord server or not linked to a player."
            className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/70"
          >
            <CircleAlert className="h-4 w-4 text-[#f5c518]" />
          </span>
        ) : null}
      </div>

      {/* Avatar in its rank ring (and the equipped frame), overlapping the banner. */}
      <div className="relative flex justify-center" style={{ marginTop: -avatarPx / 2 }}>
        {member.leader ? (
          <Crown className="absolute -top-4 left-1/2 z-20 h-4 w-4 -translate-x-1/2 text-hl-gold drop-shadow" aria-label="Party leader" />
        ) : null}
        <AvatarFrame frame={member.frame}>
          <span
            className="grid place-items-center rounded-full"
            style={{
              width: avatarPx,
              height: avatarPx,
              padding: 3,
              background: `conic-gradient(${r.color} ${Math.round(r.progress * 360)}deg, rgba(255,255,255,0.12) 0deg)`,
            }}
          >
            <span className="grid h-full w-full place-items-center overflow-hidden rounded-full border-2 border-[#141414] bg-[#222]">
              {member.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- Roblox/Discord avatar CDNs
                <img src={member.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserRound className="h-1/2 w-1/2 text-[#ff5500]/80" strokeWidth={1.5} />
              )}
            </span>
          </span>
        </AvatarFrame>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center px-2 pb-3 pt-2 text-center">
        <div className="flex max-w-full items-center justify-center gap-1 text-sm font-black text-white">
          <span className="truncate" title={member.discordUsername ? `@${member.discordUsername}` : undefined}>
            {member.clubTag ? <span className="text-[#ff5500]">[{member.clubTag}] </span> : null}
            {member.username}
          </span>
          {member.mmAccess ? (
            <MmAccessBadge />
          ) : member.verified != null ? (
            <span title={member.verified ? "Verified — in the Discord server" : "Not verified — not in the Discord server"}>
              <BadgeCheck className={`h-3.5 w-3.5 shrink-0 ${member.verified ? "text-hl-green" : "text-hl-red"}`} />
            </span>
          ) : null}
        </div>
        {member.country ? (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-white/55">
            <Flag src={flagPath(member.country)} name={countryName(member.country)} className="h-3 w-4" />
            {member.country}
          </span>
        ) : null}
        <div className="mt-auto flex flex-col items-center gap-0.5 pt-2">
          <RankBadge rank={rank} size="md" showGlow={false} />
          <span className="text-[11px] tabular-nums text-white/60">
            {rank === "UNRANKED" ? "Unranked" : typeof member.elo === "number" && member.elo > 0 ? `${member.elo.toLocaleString("en-US")} Elo` : rank}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * FACEIT-style 5-slot lobby row: player cards (same look as the league's —
 * banner art, rank-ring avatar, [TAG] name, level badge), your own card raised
 * in the center, teammates filling the slots around it, and the last free
 * slot doubling as "Find parties".
 */
export function LobbySlots({ members, size = 5, findPartiesHref = "/party-finder" }: LobbySlotsProps) {
  const center = Math.floor(size / 2);
  const row = useRef<HTMLDivElement>(null);
  // Phones scroll the row sideways: start on your own (middle) card, not the first slot.
  useEffect(() => {
    const el = row.current;
    const mid = el?.children[center] as HTMLElement | undefined;
    if (!el || !mid || el.scrollWidth <= el.clientWidth) return;
    const a = el.getBoundingClientRect();
    const b = mid.getBoundingClientRect();
    el.scrollLeft += b.left + b.width / 2 - (a.left + a.width / 2);
  }, [center, members.length]);

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

  const slot = "h-[272px] w-[170px] shrink-0 snap-center lg:w-auto";
  const empty = `${slot} flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.015]`;

  return (
    <div
      ref={row}
      className={
        size === 1
          ? "flex items-center justify-center"
          : "-mx-1 flex snap-x snap-mandatory items-center gap-3 overflow-x-auto px-1 pb-2 pt-3 lg:mx-0 lg:grid lg:snap-none lg:grid-cols-5 lg:overflow-visible lg:px-0"
      }
    >
      {positions.map((member, i) => {
        const isCenter = i === center;
        const isLast = i === size - 1 && size > 1;

        if (member) {
          return (
            <div
              key={i}
              className={`${slot} ${size === 1 ? "!w-[220px]" : ""} ${isCenter && size > 1 ? "z-10 lg:-my-3 lg:h-[296px]" : ""}`}
            >
              <LobbyCard member={member} center={isCenter} />
            </div>
          );
        }

        // Last empty slot doubles as "find parties".
        if (isLast) {
          return (
            <Link key={i} href={findPartiesHref} className={`${empty} transition-colors hover:border-[#ff5500]/50 hover:bg-[#ff5500]/[0.04]`}>
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.06]">
                <Search className="h-6 w-6 text-white/60" />
              </span>
              <span className="text-xs font-black uppercase tracking-wide text-white/70">Find parties</span>
            </Link>
          );
        }

        return (
          <div key={i} className={empty} aria-label="Open party slot">
            <Plus className="h-8 w-8 text-white/25" />
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">Open slot</span>
          </div>
        );
      })}
    </div>
  );
}
