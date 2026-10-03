"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Flame, MapPin, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MapThumb } from "@/components/map-thumb";
import { RankBadge } from "@/components/rank-badge";
import { EloChart, type EloPoint } from "@/components/profile/elo-chart";
import { RANK_TIERS, getRankForElo } from "@/data/ranks";
import { formatSigned } from "@/lib/match-stats";
import { tierProgress } from "@/lib/profile-stats";
import type { RankTierLetter } from "@/types";
import type { ProfilePlayer, ProfileStats } from "@/components/profile/types";

// recharts (~380 KB) only loads when the Stats tab opens (docs/PERFORMANCE_PLAN.md step 13).
const MetricChart = dynamic(() => import("@/components/metric-chart").then((m) => m.MetricChart), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-xl bg-white/[0.04]" />,
});

type Scope = "season" | "career";

const LADDER = RANK_TIERS.filter((t) => !["UNRANKED", "STAR"].includes(t.letter));
/** FACEIT-style ladder progression colors: white → green → yellow → orange → red. */
const LADDER_COLORS: Record<string, string> = {
  D: "#e8e8e8",
  C: "#4ade80",
  B: "#22c55e",
  A1: "#facc15",
  A2: "#eab308",
  A3: "#f59e0b",
  S1: "#f97316",
  S2: "#ef4444",
  S3: "#dc2626",
};

/** Elo points for a scope: this season's segment, or every season with breaks.
 *  The newest points of the current season carry their matches (tooltips, W/L marks). */
export function scopeEloPoints(player: ProfilePlayer, scope: Scope): EloPoint[] {
  const history = player.eloHistory ?? [];
  const lastBreak = history.lastIndexOf(null);
  const part = scope === "season" ? history.slice(lastBreak + 1) : history;
  const points: EloPoint[] = part.map((elo) => ({ elo }));
  const seasonStart = scope === "season" ? 0 : lastBreak + 1;
  const resetAt = player.lastResetAt ?? null;
  const seasonMatches = (player.matchHistory ?? []).filter((m) => !resetAt || (m.date && m.date >= resetAt));
  let p = points.length - 1;
  for (const m of seasonMatches) {
    if (p <= seasonStart || points[p].elo == null) break;
    points[p] = { ...points[p], match: m };
    p--;
  }
  return points;
}

function Tile({ value, label, color }: { value: React.ReactNode; label: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#161616] px-3.5 py-3 md:px-4 md:py-3.5">
      <div className="text-lg md:text-[1.375rem] font-extrabold tabular-nums leading-tight whitespace-nowrap" style={{ color: color || "#fff" }}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[#8a8a8a]">{label}</div>
    </div>
  );
}

function SideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-[#c8c8c8]">
      <span>{label}</span>
      <b className="inline-flex items-center gap-1.5 tabular-nums text-white">{children}</b>
    </div>
  );
}

/** Games › Stats (docs/PROFILE_UI_PLAN.md §4.12): one meaning per name, loaded on open. */
export function StatsTab({ player }: { player: ProfilePlayer }) {
  const [scope, setScope] = useState<Scope>("season");
  const [cache, setCache] = useState<Partial<Record<Scope, ProfileStats>>>({});
  const [errors, setErrors] = useState<Partial<Record<Scope, string>>>({});
  const stats = cache[scope];
  const error = stats ? null : errors[scope] ?? null;

  useEffect(() => {
    if (cache[scope]) return;
    let cancelled = false;
    fetch(`/api/players/${encodeURIComponent(player.username)}/stats?scope=${scope}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load stats");
        if (!cancelled) setCache((c) => ({ ...c, [scope]: data as ProfileStats }));
      })
      .catch((e) => {
        if (!cancelled) setErrors((m) => ({ ...m, [scope]: e instanceof Error ? e.message : "Failed to load stats" }));
      });
    return () => {
      cancelled = true;
    };
  }, [scope, cache, player.username]);

  const points = useMemo(() => scopeEloPoints(player, scope), [player, scope]);
  const plotted = points.map((p) => p.elo).filter((e): e is number => e != null);
  const high = plotted.length ? Math.max(...plotted) : null;
  const low = plotted.length ? Math.min(...plotted) : null;
  const lastBreak = points.map((p) => p.elo).lastIndexOf(null);
  const current = points.slice(lastBreak + 1).map((p) => p.elo as number);
  const sincePlacement = current.length > 1 ? current[current.length - 1] - current[0] : 0;
  const placed = !!player.placementDone;
  const rank = (placed ? player.rank : "UNRANKED") as RankTierLetter;
  const progress = placed ? tierProgress(rank, player.elo) : null;
  const currentIdx = placed ? (rank === "STAR" ? LADDER.length : LADDER.findIndex((t) => t.letter === rank)) : -1;
  const peak = scope === "season" ? player.peakElo : Math.max(player.peakElo, high ?? 0);
  const resetAt = player.lastResetAt ?? null;
  const chartMatches = useMemo(
    () =>
      scope === "season"
        ? (player.matchHistory ?? []).filter((m) => !resetAt || (m.date && m.date >= resetAt))
        : player.matchHistory ?? [],
    [scope, player.matchHistory, resetAt]
  );
  const t = stats?.totals;
  const seasonLabel = player.season?.label ?? "This season";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[0.625rem] border border-white/[0.08] bg-[#1c1c1c] p-[3px]" role="tablist" aria-label="Stats scope">
          {(["season", "career"] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={`h-[1.875rem] rounded-[0.4375rem] px-3.5 text-[0.8125rem] font-bold ${
                scope === s ? "bg-[#2a2a2a] text-white" : "text-[#8a8a8a] hover:text-white"
              }`}
            >
              {s === "season" ? seasonLabel : "Career"}
            </button>
          ))}
        </div>
        <span className="text-xs text-[#8a8a8a]">
          Ranked matches only — placements and test matches aren&apos;t counted.
        </span>
      </div>

      <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[0.625rem] bg-[#161616] px-3.5 py-3">
          <div className="flex items-center gap-3">
            <RankBadge rank={rank} size="md" className="!h-11 !w-11" />
            <div>
              <div className="text-[1.375rem] font-black leading-none tabular-nums text-white">{placed ? player.elo : "—"}</div>
              <div className="mt-1 text-xs text-[#8a8a8a]">
                {placed
                  ? `Skill level ${getRankForElo(player.elo).name} · ${seasonLabel}`
                  : `Placement ${player.placementGamesPlayed ?? 0}/${player.placementGamesTotal ?? 3}`}
              </div>
            </div>
          </div>
          {progress?.next && progress.toNext != null ? (
            <div className="text-right">
              <div className="text-[1.375rem] font-black leading-none tabular-nums text-white">{progress.toNext}</div>
              <div className="mt-1 text-xs text-[#8a8a8a]">Elo to the next skill level</div>
            </div>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-1.5 overflow-x-auto pb-1">
          {LADDER.map((tier, i) => {
            const achieved = i < currentIdx;
            const isCurrent = i === currentIdx;
            const fill = achieved ? 100 : isCurrent ? Math.max(6, progress?.percent ?? 0) : 0;
            return (
              <div key={tier.letter} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <RankBadge
                  rank={tier.letter}
                  size={isCurrent ? "md" : "sm"}
                  showGlow={isCurrent}
                  className={!achieved && !isCurrent ? "opacity-30 grayscale" : ""}
                />
                <span className={`text-[0.6875rem] tabular-nums ${isCurrent ? "font-bold text-white" : "text-hl-muted"}`}>
                  {tier.minElo}
                </span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-hl-border">
                  {fill > 0 ? (
                    <span className="block h-full rounded-full" style={{ width: `${fill}%`, backgroundColor: LADDER_COLORS[tier.letter] }} />
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile value={t ? t.matches : "—"} label="Matches" />
        <Tile
          value={t && t.matches ? `${t.winPercent.toFixed(1)}%` : "—"}
          label="Win rate"
          color={t && t.matches ? (t.winPercent >= 50 ? "#2ecc71" : "#e74c3c") : undefined}
        />
        <Tile value={stats ? stats.longestWinStreak : "—"} label="Longest win streak" />
        <Tile value={peak > 0 ? peak : "—"} label="Peak Elo" />
      </div>

      <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-4 md:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[0.9375rem] font-bold text-white">
          <TrendingUp className="h-4 w-4 text-[#8a8a8a]" /> Elo history · {scope === "season" ? seasonLabel : "every season"}
        </h2>
        {plotted.length > 1 ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_12.5rem]">
            <EloChart points={points} height={250} placedLabel={scope === "season"} />
            <div className="grid grid-cols-2 gap-3 self-start rounded-[0.625rem] bg-[#161616] p-3.5 lg:grid-cols-1">
              <div className="col-span-2 lg:col-span-1 flex items-center gap-1.5 rounded-lg bg-[#232323] px-2.5 py-2 text-[0.9375rem] font-extrabold tabular-nums">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#2ecc71] text-[0.75rem] text-[#0d2a18]">W</span>
                {t ? t.wins : "–"}
                <span className="mx-0.5 font-medium text-[#8a8a8a]">/</span>
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#e74c3c] text-[0.75rem] text-[#2a0d0d]">L</span>
                {t ? t.losses : "–"}
              </div>
              <SideRow label="Highest Elo">
                {high != null ? <RankBadge rank={getRankForElo(high).letter} size="sm" showGlow={false} className="!h-[1.125rem] !w-[1.125rem]" /> : null}
                {high ?? "—"}
              </SideRow>
              <SideRow label="Lowest Elo">
                {low != null && low > 0 ? <RankBadge rank={getRankForElo(low).letter} size="sm" showGlow={false} className="!h-[1.125rem] !w-[1.125rem]" /> : null}
                {low ?? "—"}
              </SideRow>
              {scope === "season" ? (
                <SideRow label="Since placement">
                  <span className={sincePlacement >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{formatSigned(sincePlacement)}</span>
                </SideRow>
              ) : null}
              <SideRow label="Avg Elo swing">{t ? `±${Math.round(t.eloSwing)}` : "—"}</SideRow>
            </div>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-[#8a8a8a]">Not enough matches to chart yet.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          value={t && t.matches ? `${Math.round(t.kills)} / ${Math.round(t.deaths)} / ${Math.round(t.assists)}` : "—"}
          label="K/D/A per match"
        />
        <Tile value={t && t.matches ? t.kd.toFixed(2) : "—"} label="K/D" />
        <Tile value={t?.kr != null ? t.kr.toFixed(2) : "—"} label="K/R" />
        <Tile value={t && t.matches ? `${Math.round(t.hsPercent)}%` : "—"} label="HS%" />
        <Tile value={t?.adr != null ? t.adr.toFixed(1) : "—"} label="ADR" />
        <Tile value={t && t.matches ? t.mvpsPerMatch.toFixed(1) : "—"} label="MVPs per match" />
      </div>

      {stats?.cb ? (
        <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[0.9375rem] font-bold text-white">Multi-kills &amp; openings</h2>
            <span className="text-xs text-[#8a8a8a]">
              {stats.cb.matches} {stats.cb.matches === 1 ? "match" : "matches"} with Counter Blox&apos;s own scoreboard
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-6">
            <Tile value={stats.cb.firstKills} label="First kills" />
            <Tile value={stats.cb.rounds2k} label="2K rounds" />
            <Tile value={stats.cb.rounds3k} label="3K rounds" />
            <Tile value={stats.cb.rounds4k} label="4K rounds" />
            <Tile value={stats.cb.rounds5k} label="Aces" />
            <Tile value={stats.cb.roundsPlayed} label="Rounds played" />
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
        <div className="flex items-baseline justify-between gap-2 border-b border-white/[0.08] px-4 py-3.5 md:px-5">
          <h2 className="text-[0.9375rem] font-bold text-white">Map stats</h2>
          <span className="text-xs text-[#8a8a8a]">{scope === "season" ? seasonLabel : "Career"}</span>
        </div>
        {!stats ? (
          <div className="h-32 animate-pulse bg-white/[0.02]" />
        ) : stats.maps.length === 0 ? (
          <EmptyState icon={MapPin} title="No map data" hint="Map numbers appear once this player has ranked matches." />
        ) : (
          <div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_3rem_minmax(0,1.3fr)_3.5rem] gap-3 px-4 py-2.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-[#6a6a6a] md:grid-cols-[minmax(0,1.4fr)_4.5rem_minmax(0,1.3fr)_3.5rem_3.5rem_4.5rem] md:px-5">
              <span>Map</span>
              <span>Matches</span>
              <span>Win %</span>
              <span>K/D</span>
              <span className="hidden md:block">ADR</span>
              <span className="hidden md:block">Elo ±</span>
            </div>
            {stats.maps.map((m) => {
              const good = m.winPercent >= 50;
              return (
                <div
                  key={m.map}
                  className="grid grid-cols-[minmax(0,1.4fr)_3rem_minmax(0,1.3fr)_3.5rem] items-center gap-3 border-t border-white/[0.05] px-4 py-2.5 text-sm md:grid-cols-[minmax(0,1.4fr)_4.5rem_minmax(0,1.3fr)_3.5rem_3.5rem_4.5rem] md:px-5"
                >
                  <span className="flex min-w-0 items-center gap-2.5 font-semibold text-white">
                    <MapThumb map={m.map} className="h-[1.625rem] w-10" />
                    <span className="truncate">{m.map}</span>
                  </span>
                  <span className="tabular-nums text-[#c8c8c8]">{m.matches}</span>
                  <span className="flex items-center gap-2.5">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2a2a2a]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${m.winPercent}%`, backgroundColor: good ? "#2ecc71" : "#e74c3c" }}
                      />
                    </span>
                    <b className={`w-10 text-right text-[0.8125rem] tabular-nums ${good ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
                      {Math.round(m.winPercent)}%
                    </b>
                  </span>
                  <span className={`tabular-nums font-semibold ${m.kd >= 1 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
                    {m.kd.toFixed(2)}
                  </span>
                  <span className="hidden tabular-nums text-[#c8c8c8] md:block">{m.adr != null ? Math.round(m.adr) : "—"}</span>
                  <span className={`hidden tabular-nums font-semibold md:block ${m.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
                    {formatSigned(m.eloChange)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {chartMatches.length > 1 ? (
        <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] p-4 md:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[0.9375rem] font-bold text-white">
            <Flame className="h-4 w-4 text-[#8a8a8a]" /> Per match
            <span className="text-xs font-medium text-[#8a8a8a]">last {chartMatches.length}</span>
          </h2>
          <MetricChart matches={chartMatches} />
        </section>
      ) : null}

      {error ? <p className="text-center text-xs text-hl-red">{error}</p> : null}
    </div>
  );
}
