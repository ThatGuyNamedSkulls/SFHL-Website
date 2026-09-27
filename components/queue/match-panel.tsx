"use client";

import { useState } from "react";
import Link from "next/link";
import { Server, Swords } from "lucide-react";
import { PrimaryButton } from "@/components/queue/action-bar";
import { ModePicker, ServerPicker } from "@/components/queue/play-options";
import { QUEUE_REGIONS, isQueueRegion } from "@/lib/regions";
import type { QueueUi } from "@/lib/queue-ui-state";

/**
 * FACEIT-style bottom panel: MATCH TYPE tab on the left, FIND MATCH in the
 * middle of the top edge, SERVERS tab on the right; the mode cards (or server
 * cards) centered below; live counts in the footer.
 */
export function MatchPanel({
  ui,
  discordInvite,
  onFind,
  onCancel,
  mode,
  onMode,
  region,
  onRegion,
  openRegions,
  openModesHere,
  counts,
  lockReasons,
  teamSize,
  liveMatches,
  queuingAll,
  subCount,
  regionCounts,
}: {
  ui: QueueUi;
  discordInvite: string | null;
  onFind: () => void;
  onCancel: () => void;
  mode: string;
  onMode: (mode: string) => void;
  region: string;
  onRegion: (region: string) => void;
  openRegions: string[];
  openModesHere: string[];
  counts: Record<string, number>;
  lockReasons: Record<string, string | undefined>;
  teamSize: number;
  liveMatches: number;
  queuingAll: number;
  subCount: number;
  regionCounts: Record<string, number>;
}) {
  const [tab, setTab] = useState<"type" | "servers">("type");
  const regionShort = isQueueRegion(region) ? QUEUE_REGIONS.find((r) => r.id === region)?.short : "None";
  const tabClass = (on: boolean) =>
    `relative inline-flex h-full items-center gap-2 text-xs font-black uppercase tracking-[0.08em] transition-colors ${
      on ? "text-hl-gold" : "text-white/60 hover:text-white"
    }`;

  return (
    <section className="relative mt-8 rounded-xl border border-white/[0.08] bg-hl-surface-1 lg:mt-14">
      {/* Find match sits on the panel's top edge, centered (desktop). */}
      <div className="absolute left-1/2 top-0 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
        <PrimaryButton ui={ui} discordInvite={discordInvite} onFind={onFind} onCancel={onCancel} size="panel" />
      </div>

      <div role="tablist" aria-label="Queue options" className="flex h-14 items-stretch justify-between border-b border-white/[0.06] px-5">
        <button type="button" role="tab" aria-selected={tab === "type"} onClick={() => setTab("type")} className={tabClass(tab === "type")}>
          <Swords className="h-4 w-4" /> Match type
          {tab === "type" ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-hl-gold" /> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === "servers"} onClick={() => setTab("servers")} className={tabClass(tab === "servers")}>
          <Server className="h-4 w-4" /> Servers
          <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/80">{regionShort}</span>
          {tab === "servers" ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-hl-gold" /> : null}
        </button>
      </div>

      <div className="px-4 py-6 md:px-6">
        {tab === "type" ? (
          <ModePicker
            value={mode}
            onChange={onMode}
            locked={ui.lockSelection}
            openModes={openModesHere}
            counts={counts}
            lockReasons={lockReasons}
            teamSize={teamSize}
          />
        ) : (
          <ServerPicker value={region} onChange={onRegion} locked={ui.lockSelection} openRegions={openRegions} counts={regionCounts} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-white/[0.06] px-4 py-3 text-xs text-white/50">
        <span>
          Live matches: <b className="stat-number text-white/85">{liveMatches.toLocaleString("en-US")}</b>
        </span>
        <span>
          Players queuing: <b className="stat-number text-white/85">{queuingAll.toLocaleString("en-US")}</b>
        </span>
        {subCount > 0 && ui.state !== "searching" ? (
          <Link href="/subs" className="font-bold text-hl-gold hover:text-[#ff7733]">
            {subCount} {subCount === 1 ? "match needs" : "matches need"} a sub — join →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
