"use client";

import { Flame } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { Ring } from "@/components/profile/mini-charts";
import { getRankByLetter, getRankForElo } from "@/data/ranks";
import { formatSigned, ratingColor } from "@/lib/match-stats";
import { optimizedAsset } from "@/lib/optimized-asset";
import {
  currentStreak,
  dayLabel,
  formatMatchWhen,
  localDayKey,
  parseDbTime,
  tierProgress,
  windowTotals,
} from "@/lib/profile-stats";
import { sessionsByDay } from "@/lib/track-stats";
import type { Match } from "@/types";
import type { TrackData } from "@/components/track/types";

const PRESTIGE_NAMES = ["", "I", "II", "III", "IV", "V"];

const CARD =
  "relative min-h-[8.25rem] shrink-0 snap-start overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] px-[1.125rem] py-4";

function Label({ children }: { children: React.ReactNode }) {
  return <div className="header-caps text-[0.6875rem] tracking-[0.14em] text-[#8a8a8a]">{children}</div>;
}

/** Green / red marks, oldest → newest. */
function ResultDots({ matches, slots = 0 }: { matches: Match[]; slots?: number }) {
  const chrono = [...matches].reverse();
  return (
    <div className="mt-2.5 flex flex-wrap gap-1" aria-hidden>
      {chrono.map((m) => (
        <i key={m.id} className={`h-[0.3125rem] w-[1.125rem] rounded-[3px] ${m.result === "W" ? "bg-[#2ecc71]" : "bg-[#e74c3c]"}`} />
      ))}
      {Array.from({ length: Math.max(0, slots - chrono.length) }, (_, i) => (
        <i key={`slot-${i}`} className="h-[0.3125rem] w-[1.125rem] rounded-[3px] bg-[#2a2a2a]" />
      ))}
    </div>
  );
}

/** §4.1: rank, Elo and the way to the next tier — placement progress before that. */
export function SkillCard({ player, placementMatches }: { player: TrackData["player"]; placementMatches: Match[] }) {
  if (!player.placementDone) {
    const total = Math.max(1, player.placementGamesTotal);
    return (
      <section className={CARD}>
        <Label>Skill level</Label>
        <div className="mt-2.5 flex items-center gap-3.5">
          <RankBadge rank="UNRANKED" size="md" showGlow={false} className="!h-[3.25rem] !w-[3.25rem]" />
          <div>
            <div className="text-[1.75rem] font-black leading-none text-white">Placement</div>
            <div className="mt-1 text-xs text-[#8a8a8a]">
              {player.season.label} ·{" "}
              <b className="tabular-nums text-white">
                {Math.min(player.placementGamesPlayed, total)} of {total}
              </b>{" "}
              games played
            </div>
          </div>
        </div>
        <ResultDots matches={placementMatches.slice(0, total)} slots={total} />
      </section>
    );
  }

  const tier = getRankByLetter(player.rank);
  const progress = tierProgress(player.rank, player.elo);
  return (
    <section className={CARD}>
      <Label>Skill level</Label>
      <div className="mt-2.5 flex items-center gap-3.5">
        <span className="relative flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center">
          <span aria-hidden className="absolute -inset-2 rounded-full blur-[12px]" style={{ backgroundColor: tier.color, opacity: 0.6 }} />
          <RankBadge rank={player.rank} size="md" showGlow={false} className="relative !h-[3.25rem] !w-[3.25rem]" />
        </span>
        <div>
          <div className="text-[2.375rem] font-black leading-none tabular-nums text-[#ff5500]">{player.elo}</div>
          <div className="mt-1 text-xs text-[#8a8a8a]">
            {player.season.label} · {tier.name}
          </div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#2a2a2a]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(3, progress.percent)}%`, background: `linear-gradient(90deg, ${tier.color}, #ff5500)` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[0.6875rem] tabular-nums text-[#8a8a8a]">
        <span>{tier.minElo}</span>
        {progress.next && progress.toNext != null ? (
          <span className="flex items-center gap-1">
            <b className="text-white">{progress.toNext}</b> Elo to {progress.next.name}
          </span>
        ) : (
          <span>Top tier</span>
        )}
        <span>{progress.next ? progress.next.minElo : ""}</span>
      </div>
    </section>
  );
}

/** §4.2: today's matches in the viewer's time zone, or the last session. */
export function TodayCard({ recent, now }: { recent: Match[]; now: number }) {
  const todayKey = localDayKey(now);
  const today = recent.filter((m) => {
    const ms = parseDbTime(m.date);
    return ms != null && localDayKey(ms) === todayKey;
  });
  const streak = currentStreak(recent);

  if (today.length === 0) {
    const last = sessionsByDay(recent)[0];
    return (
      <section className={CARD}>
        <Label>Today</Label>
        <p className="mt-2.5 text-[0.9375rem] font-bold text-white">No matches yet today.</p>
        {last ? (
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[#8a8a8a]">
            Last played <b className="text-white">{dayLabel(last.endMs, now)}</b> · {last.totals.matches}{" "}
            {last.totals.matches === 1 ? "match" : "matches"} ·{" "}
            <b className="tabular-nums text-[#2ecc71]">{last.totals.wins}W</b>{" "}
            <b className="tabular-nums text-[#e74c3c]">{last.totals.losses}L</b> ·{" "}
            <b className={`tabular-nums ${last.totals.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
              {formatSigned(last.totals.eloChange)} Elo
            </b>
          </p>
        ) : (
          <p className="mt-1.5 text-[0.8125rem] text-[#8a8a8a]">No ranked matches yet.</p>
        )}
        {last ? <ResultDots matches={last.matches} /> : null}
      </section>
    );
  }

  const t = windowTotals(today);
  return (
    <section className={CARD}>
      <Label>Today</Label>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
        <b className="text-[1.875rem] font-black leading-none tabular-nums text-white">{t.matches}</b>
        <span className="text-sm text-[#8a8a8a]">
          {t.matches === 1 ? "match" : "matches"} · <b className="text-[0.9375rem] font-extrabold text-[#2ecc71]">{t.wins}W</b>{" "}
          <b className="text-[0.9375rem] font-extrabold text-[#e74c3c]">{t.losses}L</b>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[0.8125rem] text-[#8a8a8a]">
        <span>
          <b className={`tabular-nums ${t.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>{formatSigned(t.eloChange)}</b> Elo
        </span>
        <span>
          rating{" "}
          <b className="tabular-nums" style={{ color: ratingColor(t.rating) }}>
            {t.rating.toFixed(2)}
          </b>
        </span>
        {streak && streak.count > 1 ? (
          <span className={`inline-flex items-center gap-1 font-extrabold ${streak.result === "W" ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
            {streak.result === "W" ? <Flame className="h-3.5 w-3.5 text-[#ff7a18]" /> : null}
            {streak.result}
            {streak.count} streak
          </span>
        ) : null}
      </div>
      <ResultDots matches={today} />
    </section>
  );
}

/** §4.3: wins to the next prestige level and the Elo back to the peak. */
export function GoalsCard({ player }: { player: TrackData["player"] }) {
  const p = player.prestige;
  const peakGap = player.peakElo - player.elo;
  return (
    <section className={CARD}>
      <Label>Goals</Label>
      <div className="mt-2.5 flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <Ring
            percent={p.maxed ? 100 : (p.winsIntoLevel / p.winsPerLevel) * 100}
            size={40}
            stroke={4}
            color="#e0a068"
            label={`${p.winsIntoLevel} of ${p.winsPerLevel} wins to the next prestige`}
          >
            {p.level > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={optimizedAsset(`/badges/prestige-${p.level}.svg`)} alt="" className="h-[1.375rem] w-[1.375rem]" />
            ) : (
              <span className="text-[0.6875rem] font-extrabold tabular-nums text-[#8a8a8a]">{p.wins}</span>
            )}
          </Ring>
          <div className="min-w-0 text-[0.8125rem] leading-snug text-[#c8c8c8]">
            {p.maxed ? (
              <>
                <b className="text-sm text-white">Prestige {PRESTIGE_NAMES[p.maxLevel]}</b> · max
                <span className="block text-xs tabular-nums text-[#8a8a8a]">{p.wins} wins this season</span>
              </>
            ) : (
              <>
                <b className="text-sm text-white">Prestige {PRESTIGE_NAMES[p.level + 1]}</b> in{" "}
                <b className="tabular-nums text-white">{p.winsPerLevel - p.winsIntoLevel}</b>{" "}
                {p.winsPerLevel - p.winsIntoLevel === 1 ? "win" : "wins"}
                <span className="block text-xs tabular-nums text-[#8a8a8a]">
                  {p.winsIntoLevel}/{p.winsPerLevel} wins this level
                </span>
              </>
            )}
          </div>
        </div>

        {player.placementDone && player.peakElo > 0 ? (
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#1a1a1a]">
              <RankBadge rank={getRankForElo(player.peakElo).letter} size="sm" showGlow={false} className="!h-6 !w-6" />
            </span>
            <div className="min-w-0 text-[0.8125rem] leading-snug text-[#c8c8c8]">
              {peakGap > 0 ? (
                <>
                  <b className="text-sm tabular-nums text-white">{peakGap} Elo</b> to peak
                </>
              ) : (
                <b className="text-sm text-white">At peak Elo</b>
              )}
              <span className="block text-xs tabular-nums text-[#8a8a8a]">
                Peak {player.peakElo}
                {player.peakAt ? ` · ${formatMatchWhen(player.peakAt).day}` : ""}
              </span>
            </div>
          </div>
        ) : !player.placementDone ? (
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#1a1a1a]">
              <RankBadge rank="UNRANKED" size="sm" showGlow={false} className="!h-6 !w-6" />
            </span>
            <div className="min-w-0 text-[0.8125rem] leading-snug text-[#c8c8c8]">
              <b className="text-sm tabular-nums text-white">
                {Math.max(0, player.placementGamesTotal - player.placementGamesPlayed)} placement{" "}
                {player.placementGamesTotal - player.placementGamesPlayed === 1 ? "game" : "games"}
              </b>{" "}
              left
              <span className="block text-xs text-[#8a8a8a]">Then a skill level and Elo</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
