"use client";

import { ChevronRight, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SeasonCard } from "@/components/profile/season-card";
import { RecentPerformance } from "@/components/profile/recent-performance";
import { MatchRow, MatchTableHeader } from "@/components/profile/match-row";
import type { ProfileTab } from "@/lib/profile-link";
import type { ProfilePlayer } from "@/components/profile/types";

/** Games › Summary (docs/PROFILE_UI_PLAN.md §3). */
export function SummaryTab({
  player,
  peakAt,
  onTab,
}: {
  player: ProfilePlayer;
  peakAt: string | null;
  onTab: (tab: ProfileTab) => void;
}) {
  const matches = player.matchHistory ?? [];
  const pro = player.modes?.find((m) => m.mode === "pro" && m.placementDone);

  return (
    <div className="space-y-5">
      <SeasonCard player={player} peakAt={peakAt} />

      {pro ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[#a855f7]/30 bg-[#a855f7]/[0.06] px-4 py-3">
          <span className="text-[0.8125rem] font-black uppercase tracking-wide text-[#d8b4fe]">Pro Ladder</span>
          <span className="text-sm text-white">
            <b className="tabular-nums">{pro.elo.toLocaleString()}</b> <span className="text-[#8a8a8a]">Pro Elo</span>
          </span>
          <span className="text-sm tabular-nums text-[#bdbdbd]">
            {pro.matchesWon}W · {Math.max(0, pro.matchesPlayed - pro.matchesWon)}L
          </span>
          <span className="text-[0.8125rem] text-[#8a8a8a]">Peak {pro.peakElo.toLocaleString()}</span>
        </div>
      ) : null}

      <RecentPerformance player={player} onSeeStats={() => onTab("stats")} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[0.9375rem] font-bold text-white">Recent matches</h2>
          {matches.length > 0 ? (
            <button
              type="button"
              onClick={() => onTab("matches")}
              className="inline-flex items-center gap-1 text-[0.75rem] font-bold uppercase tracking-[0.08em] text-[#c8c8c8] hover:text-[#ff5500]"
            >
              Full match history <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
          {matches.length === 0 ? (
            <EmptyState icon={ListChecks} title="No match history" hint="This player hasn't played any ranked matches yet." />
          ) : (
            <div className="divide-y divide-white/[0.05]">
              <MatchTableHeader />
              {matches.slice(0, 8).map((m) => (
                <MatchRow key={m.id} match={m} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
