"use client";

import { useMemo } from "react";
import Link from "next/link";
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
import { PlacementTrack } from "@/components/placement-track";
import { getRankForElo } from "@/data/ranks";
import {
  performanceRating,
  kdRatio,
  killsPerRound,
  roundCount,
  avg,
  ratingColor,
  swingColor,
  swingPercent,
} from "@/lib/match-stats";
import { formatScoreDisplay } from "@/lib/format";
import { Shield } from "lucide-react";

interface RecentPerformanceProps {
  eloHistory: (number | null)[];
  matches: Match[];
  placementDone: boolean;
  placementGamesPlayed: number;
  placementGamesTotal: number;
  placementMatches: Match[];
  rank: RankTierLetter;
}

function roundsOf(m: Match): number | null {
  const raw = m.rounds?.replace(/\s/g, "") || "";
  if (!raw) return null;
  return roundCount(raw.replace(":", ","));
}

function matchRating(m: Match): number {
  return performanceRating({
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    rounds: roundsOf(m),
    score: m.score,
    mvps: m.mvps,
  });
}

function formatWhen(date: string): string {
  const raw = date.trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return date;
  return d
    .toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .toUpperCase();
}

function GraphTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: GraphPoint }[];
}) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  if (!p.match) {
    return (
      <div className="rounded-lg bg-[#1c1c1c] border border-white/10 px-3 py-2 text-xs text-[#c8c8c8] shadow-xl">
        Start
      </div>
    );
  }
  const m = p.match;
  const win = m.result === "W";
  const rating = matchRating(m);
  const swing = swingPercent(rating);
  const score = m.rounds ? formatScoreDisplay(m.rounds) : "";
  const skill = getRankForElo(p.elo ?? 0);

  return (
    <div className="w-[220px] rounded-xl bg-[#1a1a1a] border border-white/10 shadow-2xl p-3 text-[12px]">
      <div className="text-[10px] font-semibold tracking-wide text-[#8a8a8a] uppercase">
        {formatWhen(m.date)}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[13px] font-bold">
        <span className={win ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{win ? "W" : "L"}</span>
        {score ? <span className="text-white tabular-nums">{score}</span> : null}
        <span className="text-[#8a8a8a] truncate">{m.map}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <TipRow label="Rating" value={rating.toFixed(2)} color={ratingColor(rating)} />
        <TipRow
          label="Swing"
          value={`${swing >= 0 ? "+" : ""}${swing.toFixed(2)}%`}
          color={swingColor(swing)}
        />
        <TipRow label="K/D/A" value={`${m.kills} / ${m.deaths} / ${m.assists}`} />
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[#8a8a8a]">Skill level</span>
          <span className="flex items-center gap-1.5">
            <RankBadge rank={skill.letter} size="sm" showGlow={false} className="!w-4 !h-4" />
            <span className="font-bold tabular-nums text-white">{Math.round(p.elo ?? 0)}</span>
          </span>
        </div>
        <TipRow
          label="Elo change"
          value={`${m.eloChange > 0 ? "+" : ""}${m.eloChange}`}
          color={m.eloChange >= 0 ? "#2ecc71" : "#e74c3c"}
        />
      </div>
    </div>
  );
}

function TipRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#8a8a8a]">{label}</span>
      <span className="font-bold tabular-nums text-white" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

interface GraphPoint {
  matchN: number;
  elo: number | null;
  match: Match | null;
}

export function RecentPerformance({
  eloHistory,
  matches,
  placementDone,
  placementGamesPlayed,
  placementGamesTotal,
  placementMatches,
  rank,
}: RecentPerformanceProps) {
  const recent = matches.slice(0, 30);
  const chrono = useMemo(() => [...recent].reverse(), [recent]);
  const placing = !placementDone;

  const statSource = placing && placementMatches.length ? placementMatches : recent;

  const cards = useMemo(() => {
    const n = statSource.length;
    const k = avg(statSource.map((m) => m.kills));
    const d = avg(statSource.map((m) => m.deaths));
    const a = avg(statSource.map((m) => m.assists));
    const ratings = statSource.map(matchRating);
    const rating = avg(ratings);
    const kd = kdRatio(
      statSource.reduce((s, m) => s + m.kills, 0),
      statSource.reduce((s, m) => s + m.deaths, 0)
    );
    const roundTotals = statSource
      .map(roundsOf)
      .filter((r): r is number => r != null);
    const kr =
      roundTotals.length > 0
        ? statSource.reduce((s, m) => s + m.kills, 0) / roundTotals.reduce((s, r) => s + r, 0)
        : null;
    const hs = avg(statSource.map((m) => m.headshotPercent || 0));
    const score = avg(statSource.map((m) => m.score || 0));
    const wins = statSource.filter((m) => m.result === "W").length;
    const winPct = n ? (wins / n) * 100 : 0;
    const swing = n ? avg(ratings.map(swingPercent)) : 0;
    return {
      rating,
      kda: `${Math.round(k)} / ${Math.round(d)} / ${Math.round(a)}`,
      kd,
      kr,
      swing,
      hs,
      score,
      winPct,
      ratingSeries: ratings,
      kdSeries: statSource.map((m) => m.kdr),
    };
  }, [statSource]);

  const points: GraphPoint[] = useMemo(() => {
    const lastNull = eloHistory.lastIndexOf(null);
    const season = (
      lastNull === -1 ? eloHistory : eloHistory.slice(lastNull + 1)
    ).filter((e): e is number => e !== null);
    const windowMatches = [...matches].slice(0, 30).reverse();
    const windowElo = season.slice(-(windowMatches.length + 1));
    return windowElo.map((elo, i) => ({
      matchN: i,
      elo,
      match: i === 0 ? null : windowMatches[i - 1] ?? null,
    }));
  }, [eloHistory, matches]);

  const values = points.map((p) => p.elo).filter((e): e is number => e !== null);
  const maxElo = values.length ? Math.max(...values) : 0;
  const yMax = Math.max(100, Math.ceil(maxElo / 100) * 100);
  const lastBreak = eloHistory.lastIndexOf(null);
  const current = (lastBreak === -1 ? eloHistory : eloHistory.slice(lastBreak + 1)).filter(
    (e): e is number => e !== null
  );
  const eloChange = current.length > 1 ? current[current.length - 1] - current[0] : 0;
  const avgSkill = current.length ? Math.round(avg(current)) : 0;
  const wins = recent.filter((m) => m.result === "W").length;
  const losses = recent.length - wins;
  const resultDots = chrono;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-bold text-white">Recent performance</h2>
        {!placing && recent.length > 0 && (
          <span className="text-[13px] text-[#8a8a8a] flex items-center gap-3">
            Last {recent.length} Matches
            {avgSkill > 0 && (
              <span className="inline-flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-[#ff5500]" />
                <b className="text-white tabular-nums">{avgSkill}</b> Avg skill level
              </span>
            )}
          </span>
        )}
      </div>

      {placing ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#8a8a8a] mb-2">
            <span>
              {placementGamesPlayed}/{placementGamesTotal} placement matches
            </span>
            <span>
              <b className="text-[#2ecc71]">W {placementMatches.filter((m) => m.result === "W").length}</b>
              {" / "}
              <b className="text-[#e74c3c]">
                L {placementMatches.filter((m) => m.result !== "W").length}
              </b>
            </span>
          </div>
          <PlacementTrack
            total={placementGamesTotal}
            played={placementGamesPlayed}
            games={placementMatches}
            rank={rank}
            ranked={false}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#8a8a8a] mb-3">
            <span>
              Elo change{" "}
              <b className={eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>
                {eloChange > 0 ? "+" : ""}
                {eloChange}
              </b>
            </span>
            <span>
              <b className="text-[#2ecc71]">W {wins}</b>
              {" / "}
              <b className="text-[#e74c3c]">L {losses}</b>
            </span>
          </div>

          {(placementMatches.length > 0 || resultDots.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap px-8 mb-2">
              {placementMatches.map((m) => (
                <Link
                  key={`p-${m.id}`}
                  href={m.matchId ? `/match/${m.matchId}` : "#"}
                  title={`Placement — ${m.map} ${m.result}`}
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    m.result === "W" ? "bg-[#2ecc71]" : "bg-[#e74c3c]"
                  }`}
                />
              ))}
              {placementMatches.length > 0 && rank && rank !== "UNRANKED" && (
                <RankBadge rank={rank} size="sm" showGlow={false} className="!w-5 !h-5 mx-0.5" />
              )}
              {resultDots.map((m) => (
                <Link
                  key={m.id}
                  href={m.matchId ? `/match/${m.matchId}` : "#"}
                  title={`${m.map} — ${m.result}`}
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    m.result === "W" ? "bg-[#2ecc71]" : "bg-[#e74c3c]"
                  }`}
                />
              ))}
            </div>
          )}

          {points.filter((p) => p.elo != null).length > 1 ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eloFillRecent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff5500" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#ff5500" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="matchN" hide />
                  <YAxis
                    domain={[0, yMax]}
                    ticks={[0, yMax / 2, yMax].map((n) => Math.round(n))}
                    tick={{ fill: "#6a6a6a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.12)" }}
                    content={<GraphTooltip />}
                  />
                  <Area
                    type="linear"
                    dataKey="elo"
                    stroke="#ff5500"
                    strokeWidth={2}
                    fill="url(#eloFillRecent)"
                    dot={false}
                    activeDot={{ r: 5, fill: "#ff5500", stroke: "#111", strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-[#8a8a8a] py-8 text-center">Not enough matches to chart yet.</p>
          )}
        </>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        <StatCard
          label="Rating"
          value={statSource.length ? cards.rating.toFixed(2) : "—"}
          color={ratingColor(cards.rating || 0)}
          series={cards.ratingSeries}
        />
        <StatCard label="K/D/A" value={statSource.length ? cards.kda : "—"} />
        <StatCard label="K/D" value={statSource.length ? cards.kd.toFixed(2) : "—"} />
        <StatCard label="K/R" value={cards.kr != null ? cards.kr.toFixed(2) : "—"} />
        <StatCard
          label="Swing"
          value={statSource.length ? `${cards.swing >= 0 ? "+" : ""}${cards.swing.toFixed(2)}%` : "—"}
          color={swingColor(cards.swing)}
        />
        <StatCard
          label="HS%"
          value={statSource.length ? `${Math.round(cards.hs)}%` : "—"}
        />
        <StatCard
          label="Score"
          value={statSource.length ? Math.round(cards.score).toString() : "—"}
        />
        <StatCard
          label="Win rate"
          value={statSource.length ? `${Math.round(cards.winPct)}%` : "—"}
          color={cards.winPct >= 50 ? "#2ecc71" : "#e74c3c"}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  series,
}: {
  label: string;
  value: string;
  color?: string;
  series?: number[];
}) {
  const path = useMemoPath(series);
  return (
    <div className="rounded-xl bg-[#161616] border border-white/[0.06] p-3.5 min-h-[92px] flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-2xl font-black tabular-nums leading-none"
          style={{ color: color || "#fff" }}
        >
          {value}
        </span>
        {path ? (
          <svg viewBox="0 0 72 28" className="w-[72px] h-7 shrink-0" preserveAspectRatio="none">
            <path
              d={path}
              fill="none"
              stroke={color || "#ff5500"}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </div>
      <div className="text-[11px] text-[#8a8a8a] mt-2">{label}</div>
    </div>
  );
}

function useMemoPath(series?: number[]) {
  return useMemo(() => {
    if (!series || series.length < 2) return "";
    const w = 72;
    const h = 28;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / (series.length - 1)) * w;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series]);
}
