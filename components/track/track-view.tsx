"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, LineChart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNow } from "@/components/use-now";
import { useSession } from "@/components/session-provider";
import { GoalsCard, SkillCard, TodayCard } from "@/components/track/header-cards";
import { PerformanceGrid } from "@/components/track/performance-grid";
import { FormChart } from "@/components/track/form-chart";
import { Sessions } from "@/components/track/sessions";
import { OtherStats } from "@/components/track/other-stats";
import { TrackMatchHistory, type DayFocus } from "@/components/track/match-history";
import { MapsTab } from "@/components/track/maps-tab";
import type { TrackData } from "@/components/track/types";
import { getRankByLetter } from "@/data/ranks";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { profileHref } from "@/lib/profile-link";
import { windowTotals } from "@/lib/profile-stats";
import {
  DEFAULT_TRACK_RANGE,
  TRACK_RANGES,
  TRACK_RANGE_LABELS,
  isTrackRange,
  isTrackTab,
  trackHref,
  type TrackRange,
  type TrackTab,
} from "@/lib/track-link";
import { mapBreakdown, sessionsByDay } from "@/lib/track-stats";

const TABS: { id: TrackTab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "matches", label: "Match history" },
  { id: "maps", label: "Maps" },
];

const PANEL = "rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]";
const TRIGGER = "h-[2.375rem] w-full border-white/[0.08] bg-[#1c1c1c] text-sm text-white";

export function TrackSkeleton() {
  return (
    <div className="hl-page-wide max-w-[73.75rem] space-y-[1.125rem]">
      <Skeleton className="h-16 w-72 rounded-lg" />
      <div className="grid gap-3.5 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Skeleton className="h-[8.25rem] rounded-[0.875rem]" />
        <Skeleton className="hidden h-[8.25rem] rounded-[0.875rem] lg:block" />
        <Skeleton className="hidden h-[8.25rem] rounded-[0.875rem] lg:block" />
      </div>
      <Skeleton className="h-10 w-80 rounded-lg" />
      <Skeleton className="h-80 w-full rounded-[0.875rem]" />
    </div>
  );
}

/** The tab and filters, kept in the URL (?tab=maps&range=30d&map=…&mode=…). */
function useTrackParams() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const rawRange = searchParams.get("range");
  const tab: TrackTab = isTrackTab(rawTab) ? rawTab : "stats";
  const range: TrackRange = isTrackRange(rawRange) ? rawRange : DEFAULT_TRACK_RANGE;
  const map = searchParams.get("map") || null;
  const mode = searchParams.get("mode") || null;

  // Tabs go into history (Back returns to the previous tab); filters replace.
  const update = useCallback(
    (patch: Record<string, string | null>, push: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") params.delete(k);
        else params.set(k, v);
      }
      if (params.get("tab") === "stats") params.delete("tab");
      if (params.get("range") === DEFAULT_TRACK_RANGE) params.delete("range");
      const query = params.toString();
      const url = query ? `?${query}` : window.location.pathname;
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [searchParams]
  );

  return { tab, range, map, mode, update };
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-[10.625rem] flex-col gap-1.5 text-xs font-bold text-white md:min-w-0">
      {label}
      {children}
    </label>
  );
}

/**
 * A player's tracker (docs/TRACK_UI_PLAN.md): Skill · Today · Goals, then
 * Stats / Match history / Maps for one range with one set of filters. Every
 * stat is compared with the period before and with the player's skill tier
 * this season. Anyone's tracker is public at /track/<name> (Q1).
 */
export function TrackView({ name }: { name: string }) {
  const { session } = useSession();
  const { tab, range, map, mode, update } = useTrackParams();
  const now = useNow(false);
  const [focus, setFocus] = useState<DayFocus | null>(null);
  const [state, setState] = useState<{ key: string; data: TrackData | null; error: string | null } | null>(null);

  const query = new URLSearchParams({ range, ...(map ? { map } : {}), ...(mode ? { mode } : {}) }).toString();
  const key = `${name}?${query}`;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/players/${encodeURIComponent(name)}/track?${query}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) {
          setState({ key, data: null, error: res.status === 404 ? "Player not found" : "Failed to load the tracker" });
          return;
        }
        setState({ key, data: body as TrackData, error: null });
        // Aliases and other spellings land on the canonical URL.
        if (body.player?.name && body.player.name !== name) {
          window.history.replaceState(null, "", `/track/${encodeURIComponent(body.player.name)}${window.location.search}`);
        }
      } catch {
        if (!cancelled) setState({ key, data: null, error: "Failed to load the tracker" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [key, name, query]);

  const data = state?.data ?? null;
  const loading = state?.key !== key;

  const usingPlacements =
    !!data && !data.player.placementDone && data.matches.length === 0 && data.placementMatches.length > 0;
  const current = useMemo(
    () => (data ? (usingPlacements ? data.placementMatches : data.matches) : []),
    [data, usingPlacements]
  );
  const totals = useMemo(() => windowTotals(current), [current]);
  const previous = useMemo(
    () => (data?.previous && !usingPlacements ? windowTotals(data.previous) : null),
    [data, usingPlacements]
  );
  const sessions = useMemo(() => sessionsByDay(current), [current]);
  const maps = useMemo(() => mapBreakdown(current), [current]);

  const openDay = useCallback(
    (dayKey: string) => {
      setFocus((f) => ({ key: dayKey, n: (f?.n ?? 0) + 1 }));
      update({ tab: "matches" }, true);
    },
    [update]
  );

  if (state?.error && !loading) {
    return (
      <div className="hl-page-wide py-16 text-center">
        <h1 className="mb-4 text-2xl font-bold text-white">{state.error}</h1>
        <Link href="/leaderboards" className="text-hl-gold hover:underline">
          Return to Rankings
        </Link>
      </div>
    );
  }
  if (!data) return <TrackSkeleton />;

  const { player } = data;
  const isOwn = !!session?.playerName && session.playerName === player.name;
  const tierName = player.placementDone ? getRankByLetter(player.rank).name : "Unranked";
  const bench = usingPlacements ? null : data.benchmark;
  const mapLabel = (v: string) => data.options.maps.find((m) => m.value === v)?.label ?? v;
  // The URL's choice right away (the old data stays up while the new range loads).
  const mapValue = map && data.options.maps.some((m) => m.value === map) ? map : "ALL";
  const modeValue = mode && data.options.modes.includes(mode) ? mode : "ALL";
  const hasAny = data.recent.length > 0 || data.placementMatches.length > 0;

  return (
    <div className="hl-page-wide max-w-[73.75rem]">
      <div className="flex flex-col gap-[1.125rem]">
        <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="header-caps text-xs tracking-[0.14em] text-[#ff5500]">Counter Blox · {MATCH_MODE_LABEL}</div>
            <h1 className="mt-0.5 text-[1.625rem] font-black text-white">Track</h1>
            <p className="mt-1 text-[0.8125rem] text-[#8a8a8a]">
              {isOwn ? "How you've been playing" : `How ${player.name} has been playing`} — compared with the period before
              {player.placementDone ? ` and with ${tierName} players this season` : ""}.
            </p>
            <Link
              href={profileHref(player.name)}
              className="mt-1.5 inline-flex items-center gap-0.5 text-[0.8125rem] font-bold text-[#ff5500] md:hidden"
            >
              {isOwn ? "Open your profile" : `Open ${player.name}'s profile`} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="hidden items-center gap-2.5 text-[0.8125rem] text-[#c8c8c8] md:flex">
            {player.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.avatarUrl} alt="" className="h-[2.125rem] w-[2.125rem] rounded-full bg-[#2a2a2a] object-cover" />
            ) : (
              <span className="h-[2.125rem] w-[2.125rem] rounded-full bg-[#2a2a2a]" />
            )}
            <span className="leading-tight">
              <b className="text-white">{player.name}</b>
              <br />
              <Link href={profileHref(player.name)} className="inline-flex items-center gap-0.5 font-bold text-[#ff5500] hover:underline">
                Open profile <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </span>
          </div>
        </header>

        <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:-mx-6 md:scroll-px-6 md:px-6 lg:mx-0 lg:grid lg:grid-cols-[1.15fr_1fr_1fr] lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden [&>*]:w-[82%] sm:[&>*]:w-[20rem] lg:[&>*]:w-auto">
          <SkillCard player={player} placementMatches={data.placementMatches} />
          <TodayCard recent={data.recent} now={now} />
          <GoalsCard player={player} />
        </div>

        <nav
          aria-label="Track sections"
          className="sticky top-0 z-20 -mx-4 -mt-2.5 flex gap-[1.375rem] border-b border-white/[0.08] bg-[#161616]/95 px-4 pt-2.5 backdrop-blur md:static md:mx-0 md:mt-0 md:gap-7 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setFocus(null);
                update({ tab: t.id }, true);
              }}
              aria-current={tab === t.id ? "page" : undefined}
              className={`-mb-px border-b-2 pb-3 text-[0.875rem] font-extrabold uppercase tracking-[0.06em] transition-colors ${
                tab === t.id ? "border-[#ff5500] text-[#ff5500]" : "border-transparent text-[#8a8a8a] hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="-mx-4 flex items-end gap-3 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-[repeat(3,minmax(0,13.75rem))_1fr] md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
          <Filter label="Range">
            <Select value={range} onValueChange={(v) => update({ range: (v as string) ?? null }, false)}>
              <SelectTrigger className={TRIGGER} aria-label="Range">
                <SelectValue>{(v: TrackRange) => TRACK_RANGE_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-hl-border bg-hl-panel text-white">
                {TRACK_RANGES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {TRACK_RANGE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Map">
            <Select
              value={mapValue}
              onValueChange={(v) => update({ map: !v || v === "ALL" ? null : (v as string) }, false)}
            >
              <SelectTrigger className={TRIGGER} aria-label="Map">
                <SelectValue>{(v: string) => (v === "ALL" ? "All maps" : mapLabel(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent className="border-hl-border bg-hl-panel text-white">
                <SelectItem value="ALL">All maps</SelectItem>
                {data.options.maps.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          {data.options.modes.length > 1 ? (
            <Filter label="Mode">
              <Select
                value={modeValue}
                onValueChange={(v) => update({ mode: !v || v === "ALL" ? null : (v as string) }, false)}
              >
                <SelectTrigger className={TRIGGER} aria-label="Mode">
                  <SelectValue>{(v: string) => (v === "ALL" ? "All modes" : v)}</SelectValue>
                </SelectTrigger>
                <SelectContent className="border-hl-border bg-hl-panel text-white">
                  <SelectItem value="ALL">All modes</SelectItem>
                  {data.options.modes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
          ) : (
            <span className="hidden md:block" />
          )}
          <div
            className={`hidden justify-self-end text-right text-xs leading-normal text-[#8a8a8a] ${current.length ? "md:block" : ""}`}
          >
            {usingPlacements ? (
              <>
                <b className="text-white">Placement games</b> this season
              </>
            ) : data.compare ? (
              <>
                Compared with <b className="text-white">{data.compare}</b>
              </>
            ) : (
              <>No earlier period to compare with</>
            )}
            <br />
            {bench ? (
              <>
                and with <b className="text-white">{tierName} players this season</b>
              </>
            ) : player.placementDone && !usingPlacements ? (
              <>Too few {tierName} matches this season for tier averages</>
            ) : null}
          </div>
        </div>

        <div className={`flex flex-col gap-[1.125rem] transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {usingPlacements ? (
            <p className="rounded-[0.625rem] border border-[#f5b73b]/30 bg-[#f5b73b]/10 px-4 py-2.5 text-[0.8125rem] text-[#f5d58b]">
              {isOwn ? "You haven't" : `${player.name} hasn't`} finished placement this season, so these are the{" "}
              {current.length} placement {current.length === 1 ? "game" : "games"}. Ranked stats start after placement.
            </p>
          ) : null}

          {tab === "stats" &&
            (current.length === 0 ? (
              <div className={PANEL}>
                <EmptyState
                  icon={LineChart}
                  title={hasAny ? "No matches in this range" : "No ranked matches yet"}
                  hint={hasAny ? "Try a longer range, or all maps and modes." : "Stats show here after the first ranked match."}
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-[1.375rem] font-black text-white">Performance</h2>
                  <span className="text-xs text-[#8a8a8a]">
                    {totals.matches} {totals.matches === 1 ? "match" : "matches"}
                    {data.truncated ? " (the newest 500)" : ""}
                    {bench ? ` · bars: ${tierName} players this season` : ""}
                  </span>
                </div>
                <PerformanceGrid current={totals} previous={previous} benchmark={bench} tierName={tierName} />
                <FormChart matches={current} benchmark={bench} tierName={tierName} />
                <div className="grid items-start gap-[1.125rem] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                  <Sessions sessions={sessions} now={now} onOpenDay={openDay} />
                  <OtherStats totals={totals} />
                </div>
              </>
            ))}

          {tab === "matches" && <TrackMatchHistory matches={current} now={now} focus={focus} />}

          {tab === "maps" && <MapsTab maps={maps} all={totals} />}
        </div>

        {!isOwn && session?.playerName ? (
          <Link
            href={trackHref(session.playerName)}
            className="self-center text-[0.8125rem] font-bold text-[#8a8a8a] hover:text-white"
          >
            Open your own tracker
          </Link>
        ) : null}
      </div>
    </div>
  );
}
