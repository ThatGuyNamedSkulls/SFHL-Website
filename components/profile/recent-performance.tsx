"use client";

import { useMemo } from "react";
import { BarChart2, ChevronRight, Flame, Shield } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { PlacementTrack } from "@/components/placement-track";
import { EloChart, type EloPoint } from "@/components/profile/elo-chart";
import { Ring, Sparkline } from "@/components/profile/mini-charts";
import { formatSigned, ratingColor, STAT_ESTIMATE_HINT, swingColor } from "@/lib/match-stats";
import { longestWinStreak, tierProgress, windowTotals } from "@/lib/profile-stats";
import type { Match, RankTierLetter } from "@/types";
import type { ProfilePlayer } from "@/components/profile/types";

/** Summary window (docs/PROFILE_UI_PLAN.md Q6): the last 30 matches, like FACEIT. */
export const RECENT_WINDOW = 30;
const NO_MATCHES: Match[] = [];

/** The last `count + 1` Elo points for `count` matches (a start point plus one per match). */
function tailElo(series: number[], count: number, fallback?: number | null): number[] {
  if (count > 0 && series.length >= count + 1) return series.slice(-(count + 1));
  if (count > 0 && series.length > 0) return series;
  if (fallback != null && fallback > 0) return [fallback];
  return [];
}

/** Chart points for the newest matches, split at the season reset like the Elo history. */
export function recentEloPoints(player: ProfilePlayer, newestFirst: Match[]): EloPoint[] {
  const history = player.eloHistory ?? [];
  const resetAt = player.lastResetAt ?? null;
  const curr = resetAt ? newestFirst.filter((m) => m.date && m.date >= resetAt) : newestFirst;
  const prev = resetAt ? newestFirst.filter((m) => !m.date || m.date < resetAt) : [];
  const lastBreak = history.lastIndexOf(null);
  const nums = (xs: (number | null)[]) => xs.filter((e): e is number => e != null);
  const prevAll = lastBreak === -1 ? [] : nums(history.slice(0, lastBreak));
  const currAll = nums(lastBreak === -1 ? history : history.slice(lastBreak + 1));
  const toPoints = (series: number[], chrono: Match[]): EloPoint[] =>
    series.map((elo, i) => ({ elo, match: i === 0 ? null : chrono[i - 1] ?? null }));
  const prevPoints = toPoints(tailElo(prevAll, prev.length), [...prev].reverse());
  const currPoints = toPoints(tailElo(currAll, curr.length, player.elo), [...curr].reverse());
  return prevPoints.length && currPoints.length
    ? [...prevPoints, { elo: null }, ...currPoints]
    : [...prevPoints, ...currPoints];
}

function Tile({ value, label, color, title }: { value: string; label: string; color?: string; title?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#161616] px-3.5 py-3" title={title}>
      <div className="text-[1.0625rem] md:text-lg font-extrabold tabular-nums leading-tight whitespace-nowrap" style={{ color: color || "#fff" }}>
        {value}
      </div>
      <div className="mt-1 text-[0.75rem] text-[#8a8a8a]">{label}</div>
    </div>
  );
}

/** Recent performance (docs/PROFILE_UI_PLAN.md §4.7), FACEIT's layout. */
export function RecentPerformance({ player, onSeeStats }: { player: ProfilePlayer; onSeeStats: () => void }) {
  const matches = player.matchHistory ?? NO_MATCHES;
  const placing = !player.placementDone;
  const placementMatches = player.placementMatches ?? NO_MATCHES;
  const recent = useMemo(() => matches.slice(0, RECENT_WINDOW), [matches]);
  const statSource = placing && placementMatches.length ? placementMatches : recent;
  const t = useMemo(() => windowTotals(statSource), [statSource]);
  const points = useMemo(() => (placing ? [] : recentEloPoints(player, recent)), [placing, player, recent]);
  const plotted = points.map((p) => p.elo).filter((e): e is number => e != null);
  const avgElo = plotted.length ? Math.round(plotted.reduce((a, b) => a + b, 0) / plotted.length) : 0;
  const lastBreak = points.map((p) => p.elo).lastIndexOf(null);
  const current = plotted.length ? points.slice(lastBreak + 1).map((p) => p.elo as number) : [];
  const eloChange = current.length > 1 ? current[current.length - 1] - current[0] : 0;
  const streak = longestWinStreak([...recent].reverse());
  const rank = player.rank as RankTierLetter;
  const band = player.placementDone ? tierProgress(rank, player.elo) : null;
  const has = statSource.length > 0;

  return (
    <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-bold text-white">
          <BarChart2 className="h-4 w-4 text-[#8a8a8a]" /> Recent performance
        </h2>
        <button
          type="button"
          onClick={onSeeStats}
          className="inline-flex items-center gap-1 text-[0.75rem] font-bold uppercase tracking-[0.08em] text-[#c8c8c8] hover:text-[#ff5500]"
        >
          See more stats <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="my-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-3.5 text-[0.8125rem] text-[#8a8a8a]">
        {placing ? (
          <span>
            <b className="text-white tabular-nums">{player.placementGamesPlayed ?? 0}</b>/
            {player.placementGamesTotal ?? 3} placement matches
          </span>
        ) : (
          <>
            <span>
              Last <b className="text-white tabular-nums">{recent.length}</b> {recent.length === 1 ? "match" : "matches"}
            </span>
            {avgElo > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5 text-[#ff5500]" />
                  <b className="text-white tabular-nums">{avgElo}</b> avg Elo
                </span>
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#161616] px-4 py-3" title={STAT_ESTIMATE_HINT}>
          <div>
            <div className="text-[1.375rem] font-black leading-none tabular-nums" style={{ color: has ? ratingColor(t.rating) : "#8a8a8a" }}>
              {has ? t.rating.toFixed(2) : "—"}
            </div>
            <div className="mt-1.5 text-[0.75rem] text-[#8a8a8a]">Rating</div>
          </div>
          <Sparkline values={t.ratings} color={ratingColor(t.rating)} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#161616] px-4 py-3" title={STAT_ESTIMATE_HINT}>
          <div>
            <div className="text-[1.375rem] font-black leading-none tabular-nums" style={{ color: has ? swingColor(t.swing) : "#8a8a8a" }}>
              {has ? `${formatSigned(t.swing, 2)}%` : "—"}
            </div>
            <div className="mt-1.5 text-[0.75rem] text-[#8a8a8a]">Avg rating swing</div>
          </div>
          <Sparkline values={t.swings} color={swingColor(t.swing)} />
        </div>
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#161616] px-4 py-3"
          title="How steady the K/D is from match to match"
        >
          <div>
            <div className="text-[1.375rem] font-black leading-none tabular-nums text-white">
              {t.matches > 1 ? `${Math.round(t.consistency)}%` : "—"}
            </div>
            <div className="mt-1.5 text-[0.75rem] text-[#8a8a8a]">Consistency</div>
          </div>
          <Ring percent={t.consistency} size={44} stroke={5} label="Consistency" />
        </div>
      </div>

      {placing ? (
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#161616] px-4 py-2">
          <PlacementTrack
            total={player.placementGamesTotal ?? 3}
            played={player.placementGamesPlayed ?? 0}
            games={placementMatches}
            rank={rank}
            ranked={false}
            seasonLabel={player.season?.label}
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-3 rounded-xl border border-white/[0.06] bg-[#161616] p-3 lg:grid-cols-[minmax(0,1fr)_13.5rem]">
          {plotted.length > 0 ? (
            <EloChart points={points} height={230} />
          ) : (
            <p className="py-12 text-center text-sm text-[#8a8a8a]">Not enough matches to chart yet.</p>
          )}
          <div className="grid grid-cols-2 gap-3 self-start rounded-[0.625rem] bg-[#1c1c1c] p-3.5 lg:grid-cols-1">
            <div className="col-span-2 lg:col-span-1 flex items-center gap-1.5 rounded-lg bg-[#232323] px-2.5 py-2 text-[0.9375rem] font-extrabold tabular-nums">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#2ecc71] text-[0.75rem] text-[#0d2a18]">W</span>
              {t.wins}
              <span className="mx-0.5 font-medium text-[#8a8a8a]">/</span>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#e74c3c] text-[0.75rem] text-[#2a0d0d]">L</span>
              {t.losses}
            </div>
            {band ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <RankBadge rank={band.tier.letter} size="sm" showGlow={false} className="!h-5 !w-5" />
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-[#2a2a2a]">
                    <span className="block h-full bg-[#ff5500]" style={{ width: `${Math.max(3, band.percent)}%` }} />
                  </span>
                  {band.next ? <RankBadge rank={band.next.letter} size="sm" showGlow={false} className="!h-5 !w-5" /> : null}
                </div>
                <div className="mt-1 flex justify-between text-[0.6875rem] tabular-nums text-[#8a8a8a]">
                  <span>{band.tier.minElo}</span>
                  <b className="text-[0.75rem] text-white">{player.elo}</b>
                  <span>{band.next ? band.next.minElo : ""}</span>
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-[#c8c8c8]">
              <span>Elo change</span>
              <b className={`tabular-nums ${eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>{formatSigned(eloChange)}</b>
            </div>
            <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-[#c8c8c8]">
              <span>Longest win streak</span>
              <b className="inline-flex items-center gap-1 tabular-nums text-white">
                <Flame className="h-3.5 w-3.5 text-[#ff7a18]" />
                {streak}
              </b>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-2.5">
        <Tile
          value={has ? `${Math.round(t.winPercent)}%` : "—"}
          label="Win rate"
          color={has ? (t.winPercent >= 50 ? "#2ecc71" : "#e74c3c") : undefined}
        />
        <Tile value={has ? `${Math.round(t.kills)} / ${Math.round(t.deaths)} / ${Math.round(t.assists)}` : "—"} label="K/D/A" />
        <Tile value={has ? t.kd.toFixed(2) : "—"} label="K/D" />
        <Tile value={t.kr != null ? t.kr.toFixed(2) : "—"} label="K/R" title="Kills per round" />
        <Tile value={has ? `${Math.round(t.hsPercent)}%` : "—"} label="HS%" />
        <Tile value={t.adr != null ? t.adr.toFixed(1) : "—"} label="ADR" title="Average damage per round" />
      </div>
    </section>
  );
}
