"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, Info, Swords } from "lucide-react";
import { MapThumb } from "@/components/map-thumb";
import { RankBadge } from "@/components/rank-badge";
import { SubRolePill } from "@/components/sub-role-pill";
import { STAT_ESTIMATE_HINT, ratingColor } from "@/lib/match-stats";
import { adrOf, formatMatchWhen, matchRating, roundsOf } from "@/lib/profile-stats";
import type { Match } from "@/types";

/** Desktop columns: date · score · skill/Elo · rating · K/D/A · K/D · ADR · map. */
const COLS =
  "md:grid-cols-[6rem_5.5rem_minmax(9.5rem,1fr)_4rem_6.25rem_3.25rem_3.5rem_8.5rem] md:[grid-template-areas:none]";
const PHONE = "grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:'score_map_skill'_'meta_meta_rating']";

export function MatchTableHeader() {
  return (
    <div
      className={`hidden md:grid ${COLS} gap-2.5 px-4 py-2.5 text-[0.75rem] font-semibold text-[#6a6a6a] border-b border-white/[0.06]`}
    >
      <span>Date</span>
      <span>Score</span>
      <span>Skill · Elo</span>
      <span className="flex items-center gap-1" title={STAT_ESTIMATE_HINT}>
        Rating <Info className="w-3 h-3" />
      </span>
      <span>K/D/A</span>
      <span>K/D</span>
      <span>ADR</span>
      <span>Map</span>
    </div>
  );
}

function Score({ match }: { match: Match }) {
  const win = match.result === "W";
  const [mine, theirs] = (match.rounds || "").split(":");
  return (
    <span className="flex items-center font-semibold text-[#9a9a9a] tabular-nums [grid-area:score] md:[grid-area:auto]">
      <span
        className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-[5px] text-[0.75rem] font-extrabold ${
          win ? "bg-[#2ecc71]/15 text-[#2ecc71]" : "bg-[#e74c3c]/15 text-[#e74c3c]"
        }`}
      >
        {win ? "W" : "L"}
      </span>
      {match.rounds ? (
        <>
          <span className={win ? "text-white font-extrabold" : ""}>{mine}</span>
          <span className="mx-1">:</span>
          <span className={win ? "" : "text-white font-extrabold"}>{theirs}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * One match in the profile lists (docs/PROFILE_UI_PLAN.md §4.8). Times are
 * read as UTC and shown in the viewer's zone. `timeOnly` is for lists that
 * already have a day header.
 */
export function MatchRow({ match: m, timeOnly = false }: { match: Match; timeOnly?: boolean }) {
  const win = m.result === "W";
  const { day, time } = formatMatchWhen(m.date);
  const rating = matchRating(m);
  const adr = adrOf(m.damage, roundsOf(m));
  const delta = m.eloChange ?? 0;
  const kda = `${m.kills} / ${m.deaths} / ${m.assists}`;
  const href = m.matchId ? `/match/${m.matchId}` : null;
  const className = `grid ${PHONE} ${COLS} items-center gap-x-2.5 gap-y-1.5 px-3 md:px-4 py-2.5 border-l-[3px] ${
    win ? "border-l-[#2ecc71]" : "border-l-[#e74c3c]"
  } ${href ? "hover:bg-white/[0.03]" : ""}`;

  const content = (
    <>
      <span className="hidden md:block leading-tight min-w-0">
        <span className="block text-[0.875rem] font-semibold text-white truncate">{timeOnly ? time : day}</span>
        <span className="block text-[0.75rem] text-[#8a8a8a]">{timeOnly ? m.gameMode || "Ranked" : time}</span>
      </span>
      <Score match={m} />
      <span
        className="flex items-center gap-2 min-w-0 justify-self-end md:justify-self-auto [grid-area:skill] md:[grid-area:auto]"
      >
        <Swords className="hidden md:block w-3.5 h-3.5 text-[#6a6a6a] shrink-0" aria-label={m.gameMode || undefined} />
        <RankBadge
          rank={m.rank || "UNRANKED"}
          size="sm"
          showGlow={false}
          className="hidden md:block !w-[1.375rem] !h-[1.375rem] shrink-0"
        />
        {m.eloAfter != null ? (
          <span className="hidden md:inline text-[0.875rem] font-bold tabular-nums text-white">{m.eloAfter}</span>
        ) : null}
        <span
          className={`inline-flex items-center gap-0.5 text-[0.8125rem] font-bold tabular-nums ${
            delta > 0 ? "text-[#2ecc71]" : delta < 0 ? "text-[#e74c3c]" : "text-[#8a8a8a]"
          }`}
        >
          {delta > 0 ? <ArrowUp className="w-3 h-3" strokeWidth={3} /> : delta < 0 ? <ArrowDown className="w-3 h-3" strokeWidth={3} /> : null}
          {Math.abs(delta)}
        </span>
        {m.isSub || m.leftEarly ? (
          <>
            {/* Phones get the one-letter pill so the details line keeps its room. */}
            <span className="md:hidden">
              <SubRolePill isSub={m.isSub} leftEarly={m.leftEarly} share={m.subShare} compact />
            </span>
            <span className="hidden md:inline-flex">
              <SubRolePill isSub={m.isSub} leftEarly={m.leftEarly} share={m.subShare} />
            </span>
          </>
        ) : null}
      </span>
      <span className="justify-self-end md:justify-self-auto [grid-area:rating] md:[grid-area:auto]">
        <span
          className="inline-block min-w-[2.875rem] rounded-[5px] px-1.5 py-0.5 text-center text-[0.8125rem] font-extrabold tabular-nums"
          style={{
            color: ratingColor(rating),
            backgroundColor: `color-mix(in srgb, ${ratingColor(rating)} 17%, transparent)`,
            boxShadow: `inset 0 -2px 0 ${ratingColor(rating)}`,
          }}
          title={STAT_ESTIMATE_HINT}
        >
          {rating.toFixed(2)}
        </span>
      </span>
      <span className="hidden md:block text-[0.875rem] tabular-nums text-[#e8e8e8]">{kda}</span>
      <span className={`hidden md:block text-[0.875rem] font-bold tabular-nums ${m.kdr >= 1 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
        {m.kdr.toFixed(2)}
      </span>
      <span className="hidden md:block text-[0.875rem] tabular-nums text-[#e8e8e8]">{adr != null ? adr.toFixed(1) : "—"}</span>
      <span className="flex items-center gap-2.5 min-w-0 text-[0.875rem] text-[#e8e8e8] [grid-area:map] md:[grid-area:auto]">
        <MapThumb map={m.map} className="w-10 h-[1.625rem] md:w-10 md:h-[1.625rem]" />
        <span className="truncate">{m.map}</span>
      </span>
      <span className="md:hidden text-[0.75rem] text-[#8a8a8a] truncate [grid-area:meta]">
        {day} {time} · <b className="font-semibold text-[#e8e8e8] tabular-nums">{kda}</b>
        {adr != null ? (
          <>
            {" "}· ADR <b className="font-semibold text-[#e8e8e8] tabular-nums">{adr.toFixed(0)}</b>
          </>
        ) : null}
      </span>
    </>
  );

  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
