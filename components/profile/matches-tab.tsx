"use client";

import { useMemo, useState } from "react";
import { ListChecks, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { useNow } from "@/components/use-now";
import { StatsFilters, DEFAULT_FILTERS, applyMatchFilters, type MatchFilters } from "@/components/stats-filters";
import { MatchRow, MatchTableHeader } from "@/components/profile/match-row";
import { formatSigned, ratingColor } from "@/lib/match-stats";
import { dayLabel, localDayKey, parseDbTime, windowTotals } from "@/lib/profile-stats";
import type { Match } from "@/types";

const PAGE = 50;

function SummaryCell({ value, label, className = "" }: { value: React.ReactNode; label: string; className?: string }) {
  return (
    <div className={`min-w-[33%] flex-1 px-3.5 py-3 sm:min-w-[7rem] md:px-4 ${className}`}>
      <div className="text-[1.0625rem] font-extrabold tabular-nums text-white">{value}</div>
      <div className="mt-0.5 text-xs text-[#8a8a8a]">{label}</div>
    </div>
  );
}

/**
 * Games › Match history (docs/PROFILE_UI_PLAN.md §4.11): labeled filters, a
 * summary of the filtered matches, day headers and "Load more" past the 100
 * matches the profile loads first.
 */
export function MatchesTab({
  playerName,
  initial,
  initialHasMore,
}: {
  playerName: string;
  initial: Match[];
  initialHasMore: boolean;
}) {
  const [matches, setMatches] = useState<Match[]>(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS);
  const now = useNow(false);

  const maps = useMemo(() => Array.from(new Set(matches.map((m) => m.map).filter(Boolean))).sort(), [matches]);
  const modes = useMemo(
    () => Array.from(new Set(matches.map((m) => m.gameMode).filter((m): m is string => !!m))).sort(),
    [matches]
  );
  const filtered = useMemo(() => applyMatchFilters(matches, filters, now), [matches, filters, now]);
  const totals = useMemo(() => windowTotals(filtered), [filtered]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; matches: Match[]; elo: number }[] = [];
    for (const m of filtered) {
      const ms = parseDbTime(m.date);
      const key = ms == null ? "unknown" : localDayKey(ms);
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        group = { key, label: ms == null ? "Unknown date" : dayLabel(ms, now), matches: [], elo: 0 };
        out.push(group);
      }
      group.matches.push(m);
      group.elo += m.eloChange || 0;
    }
    return out;
  }, [filtered, now]);

  const loadMore = async () => {
    const last = matches[matches.length - 1]?.rowId;
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(playerName)}/matches?before=${last}&limit=${PAGE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load matches");
      setMatches((prev) => [...prev, ...(data.matches as Match[])]);
      setHasMore(!!data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  };

  if (matches.length === 0) {
    return (
      <div className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
        <EmptyState icon={ListChecks} title="No match history" hint="This player hasn't played any ranked matches yet." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatsFilters
        maps={maps}
        modes={modes}
        value={filters}
        onChange={setFilters}
        count={filtered.length}
        total={matches.length}
      />

      {filtered.length > 0 ? (
        <div className="flex flex-wrap overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] [&>*+*]:border-l [&>*+*]:border-white/[0.06]">
          <SummaryCell value={totals.matches} label="Matches" />
          <SummaryCell
            value={
              <>
                <span className="text-[#2ecc71]">{totals.wins}</span>
                <span className="mx-1 text-[#6a6a6a]">–</span>
                <span className="text-[#e74c3c]">{totals.losses}</span>
              </>
            }
            label="W – L"
          />
          <SummaryCell value={`${Math.round(totals.winPercent)}%`} label="Win rate" />
          <SummaryCell value={totals.kd.toFixed(2)} label="K/D" />
          <SummaryCell
            value={<span style={{ color: ratingColor(totals.rating) }}>{totals.rating.toFixed(2)}</span>}
            label="Avg rating"
          />
          <SummaryCell
            value={
              <span className={totals.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{formatSigned(totals.eloChange)}</span>
            }
            label="Elo"
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
        {filtered.length === 0 ? (
          <EmptyState icon={ListChecks} title="No matches match your filters" hint="Try another map, result, mode or time range." />
        ) : (
          <>
            <MatchTableHeader />
            {groups.map((g) => (
              <div key={g.key}>
                <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-[#191919] px-4 py-2 text-xs text-[#8a8a8a] first:border-t-0">
                  <b className="text-[0.6875rem] uppercase tracking-[0.08em] text-white">{g.label}</b>
                  <span className="tabular-nums">
                    {g.matches.length} {g.matches.length === 1 ? "match" : "matches"} ·{" "}
                    <span className={g.elo >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{formatSigned(g.elo)} Elo</span>
                  </span>
                </div>
                <div className="divide-y divide-white/[0.05]">
                  {g.matches.map((m) => (
                    <MatchRow key={m.id} match={m} timeOnly />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-[0.625rem] border border-white/[0.08] bg-[#1c1c1c] text-[0.8125rem] font-bold text-[#c8c8c8] hover:border-white/20 hover:text-white disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Load more · showing {matches.length}
        </button>
      ) : null}
      {error ? <p className="text-center text-xs text-hl-red">{error}</p> : null}
    </div>
  );
}
