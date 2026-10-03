"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, Info, Users } from "lucide-react";
import { MapThumb } from "@/components/map-thumb";
import { RankBadge } from "@/components/rank-badge";
import { STAT_ESTIMATE_HINT, ratingColor } from "@/lib/match-stats";
import { formatMatchWhen } from "@/lib/profile-stats";
import type { MatchSummary } from "@/lib/match-list";
import type { RankTierLetter } from "@/types";

/**
 * Site-wide match rows (/matches, the dashboard, the landing page) in the
 * profile's match-history style (components/profile/match-row.tsx): date ·
 * score · the lobby's average Elo · the best player's rating · players · map.
 * When the viewer played, the row carries their result like on the profile.
 */
const COLS =
  "md:grid-cols-[6rem_5.5rem_minmax(8.5rem,1fr)_minmax(10rem,1.2fr)_4rem_8.5rem] md:[grid-template-areas:none]";
const PHONE = "grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:'score_map_lobby'_'meta_meta_rating']";

export function MatchListHeader() {
  return (
    <div className={`hidden gap-2.5 border-b border-white/[0.06] px-4 py-2.5 text-[0.75rem] font-semibold text-[#6a6a6a] md:grid ${COLS}`}>
      <span>Date</span>
      <span>Score</span>
      <span>Lobby · Avg Elo</span>
      <span className="flex items-center gap-1" title={STAT_ESTIMATE_HINT}>
        Best player <Info className="h-3 w-3" />
      </span>
      <span>Players</span>
      <span>Map</span>
    </div>
  );
}

/** The profile's rating pill (components/profile/match-row.tsx). */
export function RatingPill({ rating, title = STAT_ESTIMATE_HINT }: { rating: number; title?: string }) {
  const c = ratingColor(rating);
  return (
    <span
      className="inline-block min-w-[2.875rem] shrink-0 rounded-[5px] px-1.5 py-0.5 text-center text-[0.8125rem] font-extrabold tabular-nums"
      style={{ color: c, backgroundColor: `color-mix(in srgb, ${c} 17%, transparent)`, boxShadow: `inset 0 -2px 0 ${c}` }}
      title={title}
    >
      {rating.toFixed(2)}
    </span>
  );
}

export function MatchListRow({ match: m }: { match: MatchSummary }) {
  const { day, time } = formatMatchWhen(m.date);
  const mine = m.mine;
  const win = mine?.result === "W";
  const [a, b] = (mine?.score || m.score || "").split(":");
  const border = mine ? (win ? "border-l-[#2ecc71]" : "border-l-[#e74c3c]") : "border-l-transparent";
  const delta = mine?.eloChange ?? 0;

  return (
    <Link
      href={`/match/${m.matchId}`}
      className={`grid ${PHONE} ${COLS} items-center gap-x-2.5 gap-y-1.5 border-l-[3px] px-3 py-2.5 hover:bg-white/[0.03] md:px-4 ${border}`}
    >
      <span className="hidden min-w-0 leading-tight md:block">
        <span className="block truncate text-[0.875rem] font-semibold text-white">{day}</span>
        <span className="block text-[0.75rem] text-[#8a8a8a]">{time}</span>
      </span>

      <span className="flex items-center font-semibold tabular-nums text-[#9a9a9a] [grid-area:score] md:[grid-area:auto]">
        {mine ? (
          <span
            className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-[0.75rem] font-extrabold ${
              win ? "bg-[#2ecc71]/15 text-[#2ecc71]" : "bg-[#e74c3c]/15 text-[#e74c3c]"
            }`}
            title="Your result"
          >
            {win ? "W" : "L"}
          </span>
        ) : null}
        {a ? (
          <>
            {/* Yours first when you played (bold if you won); else the winners' score, in bold. */}
            <span className={!mine || win ? "font-extrabold text-white" : ""}>{a}</span>
            <span className="mx-1">:</span>
            <span className={mine && !win ? "font-extrabold text-white" : ""}>{b}</span>
          </>
        ) : (
          <span className="text-[#6a6a6a]">—</span>
        )}
      </span>

      <span className="flex min-w-0 items-center gap-2 justify-self-end [grid-area:lobby] md:justify-self-auto md:[grid-area:auto]">
        <RankBadge rank={(m.avgElo ? m.avgRank : "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-[1.375rem] !w-[1.375rem] shrink-0" />
        <span className="text-[0.875rem] font-bold tabular-nums text-white">{m.avgElo ? m.avgElo.toLocaleString() : "—"}</span>
        {mine && delta ? (
          <span
            className={`hidden items-center gap-0.5 text-[0.8125rem] font-bold tabular-nums md:inline-flex ${delta > 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}
            title="Your Elo change"
          >
            {delta > 0 ? <ArrowUp className="h-3 w-3" strokeWidth={3} /> : <ArrowDown className="h-3 w-3" strokeWidth={3} />}
            {Math.abs(delta)}
          </span>
        ) : null}
      </span>

      <span className="hidden min-w-0 items-center gap-2.5 md:flex">
        {m.top ? (
          <>
            <RatingPill rating={m.top.rating} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[0.875rem] font-semibold text-[#e8e8e8]">{m.top.name}</span>
              <span className="block text-[0.75rem] tabular-nums text-[#8a8a8a]">
                {m.top.kills} / {m.top.deaths} / {m.top.assists}
              </span>
            </span>
          </>
        ) : (
          <span className="text-[#6a6a6a]">—</span>
        )}
      </span>

      <span className="hidden items-center gap-1.5 text-[0.875rem] tabular-nums text-[#e8e8e8] md:flex">
        <Users className="h-3.5 w-3.5 text-[#6a6a6a]" />
        {m.players}
      </span>

      <span className="flex min-w-0 items-center gap-2.5 text-[0.875rem] text-[#e8e8e8] [grid-area:map] md:[grid-area:auto]">
        <MapThumb map={m.map} className="h-[1.625rem] w-10" />
        <span className="truncate">{m.map}</span>
      </span>

      <span className="truncate text-[0.75rem] text-[#8a8a8a] [grid-area:meta] md:hidden">
        {day} {time}
        {m.top ? (
          <>
            {" "}· Best <b className="font-semibold text-[#e8e8e8]">{m.top.name}</b>
          </>
        ) : null}
      </span>
      <span className="justify-self-end [grid-area:rating] md:hidden">{m.top ? <RatingPill rating={m.top.rating} /> : null}</span>
    </Link>
  );
}
