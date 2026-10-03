"use client";

import Link from "next/link";
import { ClubMark } from "@/components/club-identity";
import { RankBadge } from "@/components/rank-badge";
import { JoiningChip, PlayerAvatar, WeekBars } from "@/components/clans/ui";
import { clanHref, weekBars } from "@/lib/clan-ui";
import type { RankTierLetter } from "@/types";
import type { ClanListItem } from "@/components/clans/types";

/**
 * A clan in the list (docs/CLANS_UI_PLAN.md §4.4): a banner softly tinted with
 * the clan's color, Open / Invite only, logo, name and tag, a line of
 * description, the first members, the average rank and Elo of its ranked
 * members, and its matches together over the last 7 days.
 */
export function ClanCard({ clan, now }: { clan: ClanListItem; now: number }) {
  const s = clan.stats;
  const week = s?.week.length ?? 0;
  return (
    <Link
      href={clanHref(clan.id)}
      className="flex flex-col overflow-hidden rounded-[0.625rem] border border-white/[0.07] bg-[#1c1c1c] transition-colors hover:border-white/20"
    >
      <div
        className="relative h-14"
        style={{
          background: `linear-gradient(120deg, color-mix(in srgb, ${clan.accentColor} 42%, #1c1c1c) 0%, color-mix(in srgb, ${clan.accentColor} 10%, #1c1c1c) 75%)`,
        }}
      >
        <JoiningChip isPrivate={clan.private} className="absolute right-2.5 top-2.5" />
        <div className="absolute -bottom-5 left-3.5 rounded-[0.6875rem] shadow-[0_0_0_3px_#1c1c1c]">
          <ClubMark tag={clan.tag} accentColor={clan.accentColor} logoUrl={clan.logoUrl} size={44} className="!rounded-[0.6875rem]" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[0.4375rem] px-3.5 pb-3 pt-7">
        <h3 className="flex min-w-0 items-baseline gap-1.5 text-[0.9375rem] font-bold text-[#ededed]">
          <span className="truncate">{clan.name}</span>
          <span className="shrink-0 text-[0.8125rem] font-semibold tracking-[0.02em] text-[#ff5500]">[{clan.tag}]</span>
        </h3>
        <p className={`truncate text-[0.8125rem] ${clan.description ? "text-[#8a8a8a]" : "text-[#666]"}`}>
          {clan.description || "No description"}
        </p>
        <div className="flex items-center">
          {(s?.preview ?? []).map((m, i) => (
            <span key={`${m.name}-${i}`} className={`rounded-full shadow-[0_0_0_2px_#1c1c1c] ${i ? "-ml-1.5" : ""}`}>
              <PlayerAvatar name={m.name} src={m.avatar} size={24} />
            </span>
          ))}
          <span className="ml-2 text-xs text-[#8a8a8a]">
            {clan.memberCount} {clan.memberCount === 1 ? "member" : "members"}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2.5 border-t border-white/[0.05] px-3.5 py-2.5 text-xs text-[#8a8a8a]">
        <span className="flex items-center gap-1.5">
          {s && s.avgElo ? (
            <>
              <RankBadge rank={s.avgRank as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5" />
              <b className="text-[0.8125rem] font-bold tabular-nums text-[#ededed]">{s.avgElo.toLocaleString()}</b> avg
            </>
          ) : (
            "No ranked members"
          )}
        </span>
        <span className="flex items-center gap-2.5" title="Matches with 2+ members on one team, per day, last 7 days">
          <WeekBars counts={weekBars(s?.week ?? [], now)} />
          {week ? (
            <span>
              <b className="font-semibold tabular-nums text-[#ededed]">{week}</b> this week
            </span>
          ) : (
            <span>Quiet this week</span>
          )}
        </span>
      </div>
    </Link>
  );
}
