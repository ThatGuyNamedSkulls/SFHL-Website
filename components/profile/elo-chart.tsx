"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RANK_TIERS, getRankForElo } from "@/data/ranks";
import { optimizedAsset } from "@/lib/optimized-asset";
import { formatScoreDisplay } from "@/lib/format";
import { formatSigned, ratingColor } from "@/lib/match-stats";
import { formatMatchWhen, matchRating } from "@/lib/profile-stats";
import type { Match } from "@/types";

export interface EloPoint {
  /** null = a season reset (the line breaks there). */
  elo: number | null;
  /** The match that ended on this Elo (none for a season's starting point). */
  match?: Match | null;
}

const PAD = { left: 58, right: 12, top: 14, bottom: 26 };
const CURRENT = "#ff5500";
const PAST = "#6a6a6a";
/** Tier thresholds that get a line, with the icon of the tier that starts there. */
const THRESHOLDS = RANK_TIERS.filter((t) => t.letter !== "UNRANKED" && t.letter !== "STAR" && t.minElo > 1);

/** The tier's icon in /public/ranks, or null for Unranked / ★ (no icon). */
function rankIcon(letter: string): string | null {
  if (letter === "UNRANKED" || letter === "STAR") return null;
  return optimizedAsset(`/ranks/${letter.toLowerCase()}.png`);
}

/**
 * The profile's Elo line (docs/PROFILE_UI_PLAN.md §4.7): tier lines with their
 * rank icons on the axis, a W/L mark under each match, the current season in
 * orange (earlier ones grey) and a tooltip per match.
 */
export function EloChart({
  points,
  height = 230,
  placedLabel = false,
  className = "",
}: {
  points: EloPoint[];
  height?: number;
  /** Mark the current season's first point "Placed". */
  placedLabel?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const values = points.map((p) => p.elo).filter((e): e is number => e != null);
    if (values.length === 0 || width < 120) return null;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const yMin = Math.max(0, Math.floor((lo - 45) / 50) * 50);
    const yMax = Math.ceil((hi + 45) / 50) * 50;
    const n = Math.max(1, points.length - 1);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / n) * plotW);
    const y = (v: number) => PAD.top + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * plotH;

    // Contiguous runs between season breaks; the last one is the current season.
    const segments: number[][] = [];
    let run: number[] = [];
    points.forEach((p, i) => {
      if (p.elo == null) {
        if (run.length) segments.push(run);
        run = [];
      } else run.push(i);
    });
    if (run.length) segments.push(run);

    const ticks = THRESHOLDS.filter((t) => t.minElo > yMin && t.minElo < yMax);
    return { x, y, yMin, yMax, segments, ticks, step: plotW / n };
  }, [points, width, height]);

  const hovered = hover != null ? points[hover] : null;
  const lastSegment = geo?.segments[geo.segments.length - 1] ?? [];

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height }}>
      {geo && (
        <svg width={width} height={height} className="block select-none" onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="elo-fill-current" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CURRENT} stopOpacity={0.32} />
              <stop offset="100%" stopColor={CURRENT} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="elo-fill-past" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PAST} stopOpacity={0.22} />
              <stop offset="100%" stopColor={PAST} stopOpacity={0} />
            </linearGradient>
          </defs>

          {(geo.ticks.length ? geo.ticks.map((t) => ({ v: t.minElo, letter: t.letter as string | null })) : [
            { v: Math.round((geo.yMin + geo.yMax) / 2), letter: null },
          ]).map(({ v, letter }) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={geo.y(v)}
                y2={geo.y(v)}
                stroke="rgba(255,255,255,0.09)"
                strokeDasharray="4 5"
              />
              {letter && rankIcon(letter) && (
                <image href={rankIcon(letter)!} x={4} y={geo.y(v) - 10} width={20} height={20} />
              )}
              <text x={letter ? 27 : 8} y={geo.y(v) + 4} fill="#8a8a8a" fontSize={11}>
                {v}
              </text>
            </g>
          ))}

          {geo.segments.map((seg, si) => {
            const current = si === geo.segments.length - 1;
            const line = seg.map((i, k) => `${k ? "L" : "M"}${geo.x(i).toFixed(1)},${geo.y(points[i].elo!).toFixed(1)}`).join(" ");
            const base = height - PAD.bottom;
            return (
              <g key={si}>
                {seg.length > 1 && (
                  <path
                    d={`${line} L${geo.x(seg[seg.length - 1]).toFixed(1)},${base} L${geo.x(seg[0]).toFixed(1)},${base} Z`}
                    fill={`url(#elo-fill-${current ? "current" : "past"})`}
                  />
                )}
                <path d={line} fill="none" stroke={current ? CURRENT : PAST} strokeWidth={2} strokeLinejoin="round" />
                {si > 0 && (
                  <line
                    x1={geo.x(seg[0] - 1)}
                    x2={geo.x(seg[0] - 1)}
                    y1={PAD.top}
                    y2={height - PAD.bottom}
                    stroke="rgba(255,255,255,0.25)"
                    strokeDasharray="3 4"
                  />
                )}
              </g>
            );
          })}

          {placedLabel && lastSegment.length > 0 && (
            <g>
              <circle
                cx={geo.x(lastSegment[0])}
                cy={geo.y(points[lastSegment[0]].elo!)}
                r={4}
                fill="#161616"
                stroke={CURRENT}
                strokeWidth={2}
              />
              <text
                x={geo.x(lastSegment[0]) + 8}
                y={Math.min(height - PAD.bottom - 4, geo.y(points[lastSegment[0]].elo!) + 16)}
                fill="#8a8a8a"
                fontSize={11}
              >
                Placed · {points[lastSegment[0]].elo}
              </text>
            </g>
          )}

          {points.map((p, i) =>
            p.match && i > 0 ? (
              <rect
                key={`r${i}`}
                x={(geo.x(i - 1) + geo.x(i)) / 2 - Math.max(3, geo.step * 0.62) / 2}
                y={height - 9}
                width={Math.max(3, geo.step * 0.62)}
                height={3}
                rx={1.5}
                fill={p.match.result === "W" ? "#2ecc71" : "#e74c3c"}
              />
            ) : null
          )}

          {lastSegment.length > 0 && (
            <circle
              cx={geo.x(lastSegment[lastSegment.length - 1])}
              cy={geo.y(points[lastSegment[lastSegment.length - 1]].elo!)}
              r={5}
              fill={CURRENT}
              stroke="#111"
              strokeWidth={2}
            />
          )}

          {hover != null && hovered?.elo != null && (
            <g pointerEvents="none">
              <line
                x1={geo.x(hover)}
                x2={geo.x(hover)}
                y1={PAD.top}
                y2={height - PAD.bottom}
                stroke="rgba(255,255,255,0.14)"
              />
              <circle cx={geo.x(hover)} cy={geo.y(hovered.elo)} r={5} fill={CURRENT} stroke="#111" strokeWidth={2} />
            </g>
          )}

          {points.map((p, i) =>
            p.match && p.elo != null ? (
              <rect
                key={`h${i}`}
                x={geo.x(i) - geo.step / 2}
                y={0}
                width={Math.max(geo.step, 6)}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              />
            ) : null
          )}
        </svg>
      )}

      {geo && hover != null && hovered?.match && hovered.elo != null && (
        <EloTooltip
          match={hovered.match}
          elo={hovered.elo}
          left={Math.min(Math.max(geo.x(hover) + 14, 0), Math.max(0, width - 228))}
          top={Math.max(0, Math.min(geo.y(hovered.elo) - 20, height - 150))}
        />
      )}
    </div>
  );
}

function EloTooltip({ match: m, elo, left, top }: { match: Match; elo: number; left: number; top: number }) {
  const { day, time } = formatMatchWhen(m.date);
  const win = m.result === "W";
  const rating = matchRating(m);
  const before = elo - (m.eloChange || 0);
  const icon = rankIcon(getRankForElo(elo).letter);
  return (
    <div
      className="pointer-events-none absolute z-20 w-[13.5rem] rounded-xl border border-white/10 bg-[#1a1a1a] p-3 text-[0.8125rem] shadow-2xl"
      style={{ left, top }}
    >
      <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[#8a8a8a]">
        {day} · {time}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[0.875rem] font-bold">
        <span className={win ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{win ? "W" : "L"}</span>
        {m.rounds ? <span className="tabular-nums text-white">{formatScoreDisplay(m.rounds)}</span> : null}
        <span className="truncate text-[#8a8a8a]">{m.map}</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <Row label="Rating" value={rating.toFixed(2)} color={ratingColor(rating)} />
        <Row label="K/D/A" value={`${m.kills} / ${m.deaths} / ${m.assists}`} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#8a8a8a]">Elo</span>
          <span className="flex items-center gap-1.5 font-bold tabular-nums text-white">
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" className="h-4 w-4" />
            ) : null}
            {before} → {elo}
            <span className={(m.eloChange || 0) >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>
              ({formatSigned(m.eloChange || 0)})
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#8a8a8a]">{label}</span>
      <span className="font-bold tabular-nums text-white" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
