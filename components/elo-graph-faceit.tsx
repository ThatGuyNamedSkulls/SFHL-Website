"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Match, RankTierLetter } from "@/types";
import { RankBadge } from "@/components/rank-badge";
import { getRankForElo } from "@/data/ranks";

const GRAPH_MATCHES = 50;
const Y_PAD = 100;
const PREV_COLOR = "#e74c3c";
const CURR_COLOR = "#ff5500";

interface LastSeason {
  name: string;
  elo: number;
  rank: RankTierLetter;
}

interface EloGraphFaceitProps {
  /** ELO values oldest → newest. A `null` is a season boundary. */
  eloHistory: (number | null)[];
  /** Matches newest → oldest (as returned by the API). */
  matches: Match[];
  lastResetAt?: string | null;
  lastSeason?: LastSeason | null;
  currentElo?: number;
}

interface GraphPoint {
  matchN: number;
  elo: number | null;
}

function tailElo(series: number[], matchCount: number, fallback?: number | null): number[] {
  if (matchCount > 0 && series.length >= matchCount + 1) return series.slice(-(matchCount + 1));
  if (matchCount > 0 && series.length > 0) return series;
  if (fallback != null && fallback > 0) return [fallback];
  return [];
}

function SegmentChart({
  points,
  color,
  fillId,
  yMin,
  yMax,
  yTicks,
  showAxis,
}: {
  points: GraphPoint[];
  color: string;
  fillId: string;
  yMin: number;
  yMax: number;
  yTicks: number[];
  showAxis: boolean;
}) {
  if (!points.length) return null;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 12, right: 6, left: showAxis ? -8 : 4, bottom: 4 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="matchN" hide />
        <YAxis
          hide={!showAxis}
          domain={[yMin, yMax]}
          ticks={yTicks}
          tick={{ fill: "#6a6a6a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={showAxis ? 40 : 0}
        />
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.12)" }}
          contentStyle={{
            backgroundColor: "#1c1c1c",
            border: "1px solid #2a2a2a",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(v) => (v === 0 ? "Start" : `Match ${v}`)}
          formatter={(value) => [`${value}`, "ELO"]}
        />
        <Area
          type="linear"
          dataKey="elo"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: "#111", strokeWidth: 2 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * FACEIT-style ELO progression: last 50 matches, season-reset gap shows
 * the rank they placed into.
 */
export function EloGraphFaceit({
  eloHistory,
  matches,
  lastResetAt,
  lastSeason,
  currentElo,
}: EloGraphFaceitProps) {
  const windowAll = useMemo(() => matches.slice(0, GRAPH_MATCHES), [matches]);
  const currMatches = useMemo(
    () => (lastResetAt ? windowAll.filter((m) => m.date && m.date >= lastResetAt) : windowAll),
    [windowAll, lastResetAt]
  );
  const prevMatches = useMemo(
    () => (lastResetAt ? windowAll.filter((m) => !m.date || m.date < lastResetAt) : []),
    [windowAll, lastResetAt]
  );
  const results = useMemo(() => [...windowAll].reverse(), [windowAll]);

  const { prevPoints, currPoints, placementRank } = useMemo(() => {
    const lastNull = eloHistory.lastIndexOf(null);
    const prevEloAll =
      lastNull === -1 ? [] : eloHistory.slice(0, lastNull).filter((e): e is number => e !== null);
    const currEloAll = (lastNull === -1 ? eloHistory : eloHistory.slice(lastNull + 1)).filter(
      (e): e is number => e !== null
    );

    let prevSeries = tailElo(prevEloAll, prevMatches.length, lastSeason?.elo);
    if (lastSeason && prevSeries.length === 0 && currMatches.length < GRAPH_MATCHES) {
      prevSeries = [lastSeason.elo];
    }
    const currSeries = tailElo(currEloAll, currMatches.length, currentElo);
    const placedAt = currEloAll[0] ?? currSeries[0] ?? 0;

    return {
      prevPoints: prevSeries.map((elo, i) => ({ matchN: i, elo })),
      currPoints: currSeries.map((elo, i) => ({ matchN: i, elo })),
      placementRank: getRankForElo(placedAt).letter,
    };
  }, [eloHistory, prevMatches.length, currMatches.length, lastSeason, currentElo]);

  const values = [...prevPoints, ...currPoints]
    .map((p) => p.elo)
    .filter((e): e is number => e !== null);
  const minElo = values.length ? Math.min(...values) : 0;
  const maxElo = values.length ? Math.max(...values) : 0;
  const yMin = Math.max(0, Math.floor(minElo - Y_PAD));
  const yMax = Math.ceil(maxElo + Y_PAD);
  const yMid = Math.round((yMin + yMax) / 2);
  const yTicks = [yMin, yMid, yMax];
  const showCut = prevPoints.length > 0 && currPoints.length > 0;

  const wins = windowAll.filter((m) => m.result === "W").length;
  const losses = windowAll.length - wins;

  const eloChange = useMemo(() => {
    const current = currPoints.map((p) => p.elo).filter((e): e is number => e !== null);
    return current.length > 1 ? current[current.length - 1] - current[0] : 0;
  }, [currPoints]);

  const longestWin = useMemo(() => {
    let best = 0;
    let cur = 0;
    for (const m of results) {
      if (m.result === "W") {
        cur += 1;
        best = Math.max(best, cur);
      } else cur = 0;
    }
    return best;
  }, [results]);

  return (
    <div className="grid lg:grid-cols-[1fr_200px] gap-6">
      <div>
        {values.length > 0 ? (
          <div className="flex h-[260px] items-stretch">
            {prevPoints.length > 0 && (
              <div className="min-w-0 h-full" style={{ flex: showCut ? 1 : Math.max(prevPoints.length, 2) }}>
                <SegmentChart
                  points={prevPoints}
                  color={PREV_COLOR}
                  fillId="eloFillPrevStats"
                  yMin={yMin}
                  yMax={yMax}
                  yTicks={yTicks}
                  showAxis
                />
              </div>
            )}
            {showCut && (
              <div className="relative w-14 shrink-0 flex flex-col items-center py-3">
                <span className="flex-1 w-0 border-l border-dashed border-white/30" />
                <RankBadge
                  rank={placementRank}
                  size="md"
                  showGlow
                  className="!w-10 !h-10 my-1"
                />
                <span className="text-[9px] font-bold uppercase tracking-wide text-[#8a8a8a] mt-0.5">
                  Placed
                </span>
                <span className="flex-1 w-0 border-l border-dashed border-white/30" />
              </div>
            )}
            {currPoints.length > 0 && (
              <div className="min-w-0 h-full" style={{ flex: showCut ? 1 : Math.max(currPoints.length, 2) }}>
                <SegmentChart
                  points={currPoints}
                  color={CURR_COLOR}
                  fillId="eloFillCurrStats"
                  yMin={yMin}
                  yMax={yMax}
                  yTicks={yTicks}
                  showAxis={!prevPoints.length}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[#8a8a8a] py-8 text-center">Not enough matches to chart yet.</p>
        )}

        {results.length > 0 && (
          <div className="flex gap-px mt-1 px-8">
            {results.map((m) => (
              <span
                key={m.id}
                title={`${m.map} — ${m.result} (${m.eloChange > 0 ? "+" : ""}${m.eloChange})`}
                className={`h-[3px] flex-1 min-w-[2px] ${m.result === "W" ? "bg-[#2ecc71]" : "bg-[#e74c3c]"}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 text-sm self-center">
        <StatRow label="Wins" value={wins} valueClass="text-[#2ecc71]" />
        <StatRow label="Losses" value={losses} valueClass="text-[#e74c3c]" />
        <div className="h-px bg-white/[0.06]" />
        <StatRow label="Highest ELO" value={maxElo} />
        <StatRow label="Lowest ELO" value={minElo} />
        <StatRow
          label="ELO change"
          value={`${eloChange > 0 ? "+" : ""}${eloChange}`}
          valueClass={eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}
        />
        <StatRow label="Longest win streak" value={longestWin} valueClass="text-[#ff5500]" />
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass = "text-white",
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#8a8a8a]">{label}</span>
      <span className={`font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
