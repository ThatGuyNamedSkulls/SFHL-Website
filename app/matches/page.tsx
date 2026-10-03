"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Swords } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MatchListHeader, MatchListRow } from "@/components/match-list-row";
import { useNow } from "@/components/use-now";
import type { MatchSummary } from "@/lib/match-list";
import { dayLabel, localDayKey, parseDbTime } from "@/lib/profile-stats";

const PAGE = 50;
const PANEL = "overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]";

/** Every recorded match, newest first, in the profile's match-history style, by day. */
export default function MatchesPage() {
  const now = useNow(false);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [mapFilter, setMapFilter] = useState("ALL");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matches?limit=${PAGE}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setMatches(Array.isArray(d.matches) ? d.matches : []);
        setHasMore(!!d.hasMore);
      })
      .catch(() => !cancelled && setMatches([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = async () => {
    setMore(true);
    try {
      const d = await fetch(`/api/matches?limit=${PAGE}&offset=${matches.length}`).then((r) => r.json());
      setMatches((prev) => [...prev, ...(Array.isArray(d.matches) ? d.matches : [])]);
      setHasMore(!!d.hasMore);
    } finally {
      setMore(false);
    }
  };

  const maps = useMemo(() => Array.from(new Set(matches.map((m) => m.map))).sort(), [matches]);
  const filtered = useMemo(() => (mapFilter === "ALL" ? matches : matches.filter((m) => m.map === mapFilter)), [matches, mapFilter]);
  const days = useMemo(() => {
    const out: { key: string; label: string; list: MatchSummary[] }[] = [];
    for (const m of filtered) {
      const ms = parseDbTime(m.date);
      const key = ms == null ? "unknown" : localDayKey(ms);
      let d = out[out.length - 1];
      if (!d || d.key !== key) {
        d = { key, label: ms == null ? "Unknown date" : dayLabel(ms, now), list: [] };
        out.push(d);
      }
      d.list.push(m);
    }
    return out;
  }, [filtered, now]);

  return (
    <div className="hl-page-wide">
      <PageHeader
        icon={Swords}
        title="Matches"
        subtitle="Every recorded HyperLeague match, newest first"
        actions={
          !loading && matches.length > 0 ? (
            <Select value={mapFilter} onValueChange={(v) => setMapFilter(v ?? "ALL")}>
              <SelectTrigger className="h-9 w-[9.375rem] border-hl-border bg-hl-panel text-sm text-white" aria-label="Map">
                <SelectValue>{(v: string) => (v === "ALL" ? "All maps" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-hl-border bg-hl-panel text-white">
                <SelectItem value="ALL">All maps</SelectItem>
                {maps.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {loading ? (
        <Skeleton className="h-[28rem] w-full rounded-[0.875rem]" />
      ) : filtered.length === 0 ? (
        <div className={PANEL}>
          <EmptyState
            icon={Swords}
            title="No matches found"
            hint={matches.length === 0 ? "No matches have been recorded yet." : "No matches on this map. Try a different filter."}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className={PANEL}>
            <MatchListHeader />
            {days.map((d) => {
              const mineElo = d.list.reduce((s, m) => s + (m.mine?.eloChange ?? 0), 0);
              const played = d.list.filter((m) => m.mine).length;
              return (
                <div key={d.key}>
                  <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-[#191919] px-4 py-2 text-xs text-[#8a8a8a] first:border-t-0">
                    <b className="text-[0.6875rem] uppercase tracking-[0.08em] text-white">{d.label}</b>
                    <span className="tabular-nums">
                      {d.list.length} {d.list.length === 1 ? "match" : "matches"}
                      {played ? (
                        <>
                          {" "}· you played {played} ·{" "}
                          <span className={mineElo >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>
                            {mineElo > 0 ? "+" : ""}
                            {mineElo} Elo
                          </span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div className="divide-y divide-white/[0.05]">
                    {d.list.map((m) => (
                      <MatchListRow key={m.matchId} match={m} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={more}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-[0.625rem] border border-white/[0.08] bg-[#1c1c1c] text-[0.8125rem] font-bold text-[#c8c8c8] hover:border-white/20 hover:text-white disabled:opacity-60"
            >
              {more ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load more · showing {matches.length}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
