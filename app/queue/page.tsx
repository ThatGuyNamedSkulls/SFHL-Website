"use client";

/**
 * Play (docs/QUEUE_UI_PLAN.md), FACEIT-style: queue pill, a top strip (you ·
 * prestige path · mission), your party centered, then one panel with the
 * match types (or servers) and Find match on its top edge. No side panels.
 * Searching shows a timer and how full the lobby is; a match found opens the
 * site-wide pop-up (components/match-ready-modal.tsx). State: components/queue/use-queue-state.ts; the ready check,
 * sounds and tab title: components/use-ready-check.ts + queue-attention.tsx.
 */
import { LobbySlots } from "@/components/lobby-slots";
import { ActionBar, StatusLine } from "@/components/queue/action-bar";
import { InMatchCard, SearchStatus, SoundToggle, useSearchElapsed } from "@/components/queue/live-status";
import { MatchPanel } from "@/components/queue/match-panel";
import { PlayHeader } from "@/components/queue/play-header";
import { modeLockReasons } from "@/components/queue/play-options";
import { SetupChecklist } from "@/components/queue/setup-checklist";
import { useQueueState } from "@/components/queue/use-queue-state";
import { askNotificationPermission } from "@/components/queue-attention";
import { useReadyCheck } from "@/components/use-ready-check";
import { QUEUE_REGIONS, isQueueRegion, regionMeta, regionQueueLabel } from "@/lib/regions";
import { queueModeLabel } from "@/lib/queue-modes";
import { unlockQueueAudio } from "@/lib/queue-sounds";

export default function QueuePage() {
  const q = useQueueState();
  const { ui } = q;
  const { check } = useReadyCheck();
  const openModesHere = q.openModes[q.region] ?? (q.openRegions.includes(q.region) ? ["standard", "super"] : []);
  const lockReasons = q.session
    ? modeLockReasons({
        selfPlacing: q.selfPlacing,
        partySize: q.lineup.length,
        placingNames: q.partyInfo?.placingNames ?? [],
        proEligible: q.proEligible,
      })
    : {};
  const live = q.openRegions.includes(q.region);
  const searching = ui.state === "searching";
  const elapsed = useSearchElapsed(searching);
  const checkOnScreen = !!check && check.status !== "cancelled";
  const showStatus =
    ui.state !== "ready" && ui.state !== "loading" && ui.state !== "in_match" && ui.state !== "match_found" && !searching;
  const regionLabel = isQueueRegion(q.region) ? regionMeta(q.region).label : "No server";

  // The first Find match asks for desktop notifications (owner Q3) and
  // unlocks audio so the match-found sound can play later.
  const find = () => {
    unlockQueueAudio();
    askNotificationPermission();
    void q.join();
  };

  return (
    <div className="hl-page">
      {/* Queue pill: the server you're playing on (+ the search timer), and the sound toggle. */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.1em] ${
              searching
                ? "border-hl-green/40 bg-hl-green/10 text-hl-green"
                : live
                  ? "border-hl-gold/45 bg-hl-gold/10 text-hl-teal"
                  : "border-white/15 bg-white/[0.05] text-white/65"
            }`}
          >
            {live || searching ? (
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${searching ? "bg-hl-green" : "bg-hl-gold"}`} />
            ) : null}
            {searching && elapsed ? <span className="stat-number">{elapsed} · </span> : null}
            {regionQueueLabel(q.region, q.teamSize)}
          </span>
          {q.session ? <SoundToggle /> : null}
        </div>
        {q.autoPicked && q.autoPicked === q.region && !ui.lockSelection ? (
          <span className="text-[11px] text-white/50">
            We picked {QUEUE_REGIONS.find((r) => r.id === q.autoPicked)?.label} for you · change it in Servers
          </span>
        ) : null}
      </div>

      <div className="mt-5">
        <PlayHeader me={q.me} signedIn={!!q.session} />
      </div>

      <div className="my-6 border-t border-white/[0.06]" />

      {ui.state === "in_match" && q.lobby ? (
        <div className="mb-6">
          <InMatchCard lobby={q.lobby} />
        </div>
      ) : null}
      {ui.state === "setup" ? (
        <div className="mb-6">
          <SetupChecklist ui={ui} />
        </div>
      ) : null}

      <LobbySlots members={q.lineup} size={q.teamSize} findPartiesHref="/party-finder" />

      {searching && elapsed && !checkOnScreen ? (
        <div className="mt-8 hidden lg:block">
          <SearchStatus
            elapsed={elapsed}
            inQueue={q.modeCounts[q.mode] ?? 0}
            needed={q.teamSize * 2}
            regionLabel={regionLabel}
            modeLabel={queueModeLabel(q.mode)}
          />
        </div>
      ) : null}
      {showStatus || q.error ? (
        <div className="mt-6 hidden lg:block">
          <StatusLine ui={ui} error={q.error} />
        </div>
      ) : null}

      <div className={showStatus || q.error || searching ? "lg:mt-4" : "lg:mt-6"}>
        <MatchPanel
          ui={ui}
          discordInvite={q.discordInvite}
          onFind={find}
          onCancel={q.leave}
          mode={q.mode}
          onMode={q.setMode}
          region={isQueueRegion(q.region) ? q.region : ""}
          onRegion={q.pickRegion}
          openRegions={q.openRegions}
          openModesHere={openModesHere}
          counts={q.modeCounts}
          lockReasons={lockReasons}
          teamSize={q.teamSize}
          liveMatches={q.liveMatches}
          queuingAll={q.queuingAll}
          subCount={q.subCount}
          regionCounts={q.queuingByRegion}
        />
      </div>

      {/* Phones: the action is always one tap away, above the tab bar. */}
      <ActionBar ui={ui} error={q.error} discordInvite={q.discordInvite} onFind={find} onCancel={q.leave} elapsed={elapsed} />
    </div>
  );
}
