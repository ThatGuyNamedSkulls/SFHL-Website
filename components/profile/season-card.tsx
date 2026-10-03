"use client";

import { Flame, Globe } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { Ring } from "@/components/profile/mini-charts";
import { getRankByLetter, getRankForElo } from "@/data/ranks";
import { optimizedAsset } from "@/lib/optimized-asset";
import { currentStreak, formatMatchWhen, tierProgress } from "@/lib/profile-stats";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import type { RankTierLetter } from "@/types";
import type { ProfilePlayer } from "@/components/profile/types";

const PRESTIGE_NAMES = ["", "I", "II", "III", "IV", "V"];

/**
 * The season card (docs/PROFILE_UI_PLAN.md §4.6): peak Elo, the skill box with
 * progress to the next tier, the prestige ring, then the season record and the
 * ladder positions with labels.
 */
export function SeasonCard({ player, peakAt }: { player: ProfilePlayer; peakAt: string | null }) {
  const placed = !!player.placementDone;
  const rank = (placed ? player.rank : "UNRANKED") as RankTierLetter;
  const tierColor = getRankByLetter(rank).color;
  const progress = placed ? tierProgress(rank, player.elo) : null;
  const matches = player.matchHistory ?? [];
  const streak = currentStreak(matches);
  const prestige = player.prestige;
  const seasonLabel = player.season?.label ?? "Season 1";
  const { overall, country, region } = player.rankings ?? { overall: null, country: null, region: null };

  return (
    <section className="relative overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
      {placed && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[44%] h-36 w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ backgroundColor: tierColor, opacity: 0.26 }}
        />
      )}

      <div className="relative flex flex-wrap items-center gap-x-2 px-4 md:px-6 pt-4 md:pt-5 text-[0.8125rem]">
        <span className="header-caps text-[0.75rem] tracking-[0.14em] text-white">{seasonLabel}</span>
        <span className="text-[#8a8a8a]">· {MATCH_MODE_LABEL} Matchmaking</span>
      </div>

      <div className="relative grid grid-cols-2 lg:grid-cols-[1fr_auto_1fr] items-center gap-4 md:gap-5 px-4 md:px-6 pt-4 pb-5 [grid-template-areas:'center_center'_'peak_prestige'] lg:[grid-template-areas:'peak_center_prestige']">
        <div className="[grid-area:peak] min-w-0">
          <div className="header-caps text-[0.6875rem] tracking-[0.14em] text-[#8a8a8a]">Peak Elo</div>
          {placed && player.peakElo > 0 ? (
            <>
              <div className="mt-1.5 flex items-center gap-2 text-[1.375rem] md:text-[1.5rem] font-extrabold tabular-nums text-white">
                <RankBadge rank={getRankForElo(player.peakElo).letter} size="sm" showGlow={false} className="!w-7 !h-7" />
                {player.peakElo}
              </div>
              {peakAt ? <div className="mt-0.5 text-[0.75rem] text-[#8a8a8a]">{formatMatchWhen(peakAt).day}</div> : null}
            </>
          ) : (
            <div className="mt-1.5 text-[1.375rem] font-extrabold text-[#6a6a6a]">—</div>
          )}
        </div>

        <div className="[grid-area:center] flex flex-col items-center min-w-0 lg:min-w-[22rem]">
          <div
            className="inline-flex items-center gap-3 md:gap-4 rounded-[0.875rem] border border-white/10 bg-[#121212] py-2.5 md:py-3 pl-4 pr-5 md:pl-5 md:pr-6"
            style={placed ? { boxShadow: `inset 0 0 28px ${tierColor}38` } : undefined}
          >
            <span className="hidden sm:inline header-caps text-[0.75rem] tracking-[0.18em] text-[#9a9a9a]">Skill level</span>
            <span className="relative flex h-12 w-12 md:h-14 md:w-14 items-center justify-center">
              {placed && (
                <span
                  aria-hidden
                  className="absolute -inset-2.5 rounded-full blur-[12px]"
                  style={{ backgroundColor: tierColor, opacity: 0.75 }}
                />
              )}
              <RankBadge rank={rank} size="md" showGlow={false} className="relative !h-12 !w-12 md:!h-14 md:!w-14" />
            </span>
            {placed ? (
              <span className="text-[2.25rem] md:text-[2.75rem] font-black leading-none tabular-nums text-[#ff5500]">
                {player.elo}
              </span>
            ) : (
              <span className="text-[1.5rem] md:text-[1.75rem] font-black leading-none text-white">Unranked</span>
            )}
          </div>

          {progress ? (
            <div className="mt-3.5 w-full">
              <div className="h-1.5 overflow-hidden rounded-full bg-[#2a2a2a]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(3, progress.percent)}%`,
                    background: `linear-gradient(90deg, ${tierColor}, #ff5500)`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[0.75rem] text-[#8a8a8a] tabular-nums">
                <span>{progress.tier.minElo}</span>
                {progress.next && progress.toNext != null ? (
                  <span className="flex items-center gap-1.5 text-[#c8c8c8]">
                    <b className="text-white">{progress.toNext}</b> Elo to
                    <RankBadge rank={progress.next.letter} size="sm" showGlow={false} className="!h-4 !w-4" />
                    {progress.next.name}
                  </span>
                ) : (
                  <span className="text-[#c8c8c8]">Top tier</span>
                )}
                <span>{progress.next ? progress.next.minElo : ""}</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-[0.8125rem] text-[#8a8a8a]">
              Placement <b className="text-white tabular-nums">{player.placementGamesPlayed ?? 0}</b> of{" "}
              <b className="text-white tabular-nums">{player.placementGamesTotal ?? 3}</b>
            </div>
          )}
        </div>

        <div className="[grid-area:prestige] flex items-center gap-2 md:gap-3 justify-self-end text-left min-w-0">
          {prestige ? (
            <>
              <Ring
                percent={prestige.maxed ? 100 : (prestige.winsIntoLevel / prestige.winsPerLevel) * 100}
                size={56}
                stroke={6}
                color="#e0a068"
                label={`${prestige.winsIntoLevel} of ${prestige.winsPerLevel} wins to the next prestige`}
              >
                {prestige.level > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={optimizedAsset(`/badges/prestige-${prestige.level}.svg`)}
                    alt=""
                    className="h-7 w-7"
                  />
                ) : (
                  <span className="text-[0.75rem] font-extrabold tabular-nums text-[#8a8a8a]">{prestige.wins}</span>
                )}
              </Ring>
              <div className="min-w-0">
                <div className="text-[0.9375rem] font-bold text-white whitespace-nowrap">
                  {prestige.level > 0 ? `Prestige ${PRESTIGE_NAMES[prestige.level]}` : "Prestige"}
                </div>
                <div className="mt-0.5 text-[0.75rem] text-[#8a8a8a] whitespace-nowrap tabular-nums">
                  {prestige.maxed
                    ? `${prestige.wins} wins · max`
                    : `${prestige.winsIntoLevel}/${prestige.winsPerLevel} wins`}
                  {!prestige.maxed ? (
                    <span className="hidden sm:inline"> to {PRESTIGE_NAMES[prestige.level + 1]}</span>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/[0.06] px-4 md:px-6 py-3 text-[0.875rem] text-[#8a8a8a]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            <b className="text-white tabular-nums">{player.seasonMatchesPlayed ?? 0}</b> matches
          </span>
          <span aria-hidden>·</span>
          <span>
            <b className="text-white tabular-nums">{(player.seasonWinPercent ?? 0).toFixed(1)}%</b> win rate
          </span>
          {streak && streak.count > 1 ? (
            <>
              <span aria-hidden>·</span>
              <span className={`inline-flex items-center gap-1 font-extrabold ${streak.result === "W" ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
                {streak.result === "W" ? <Flame className="w-3.5 h-3.5 text-[#ff7a18]" /> : null}
                {streak.result}
                {streak.count}
              </span>
              <span>streak</span>
            </>
          ) : null}
        </div>
        {placed && (overall || region || country) ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {player.countryFlag && country ? (
              <span className="inline-flex items-center gap-1.5 text-[0.8125rem]" title={`#${country} in ${player.countryName}`}>
                <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-3.5" />
                <b className="text-white tabular-nums">#{country.toLocaleString()}</b>
                <span>{player.countryName}</span>
              </span>
            ) : null}
            {region && player.region ? (
              <span className="inline-flex items-center gap-1.5 text-[0.8125rem]" title={`#${region} in ${player.region}`}>
                <span className="rounded border border-white/20 px-1 text-[0.6875rem] font-extrabold text-white">{player.region}</span>
                <b className="text-white tabular-nums">#{region.toLocaleString()}</b>
              </span>
            ) : null}
            {overall ? (
              <span className="inline-flex items-center gap-1.5 text-[0.8125rem]" title={`#${overall} overall`}>
                <Globe className="w-4 h-4 text-[#ff5500]" />
                <b className="text-white tabular-nums">#{overall.toLocaleString()}</b>
                <span>Global</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
