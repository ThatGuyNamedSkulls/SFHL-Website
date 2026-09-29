"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, LogIn, Radio, Swords, XCircle } from "lucide-react";
import type { QueueUi } from "@/lib/queue-ui-state";

type Tone = "good" | "warn" | "neutral";

function toneOf(ui: QueueUi): Tone {
  if (ui.state === "searching" || ui.state === "ready" || ui.state === "in_match") return "good";
  if (ui.state === "blocked" || ui.state === "closed" || ui.state === "setup") return "warn";
  return "neutral";
}

function StatusIcon({ ui }: { ui: QueueUi }) {
  const cls = "h-4 w-4";
  if (ui.state === "searching") return <Radio className={`${cls} animate-pulse`} />;
  if (ui.state === "in_match") return <Swords className={cls} />;
  if (ui.state === "loading") return <Loader2 className={`${cls} animate-spin`} />;
  if (ui.state === "guest") return <LogIn className={cls} />;
  return toneOf(ui) === "good" ? <CheckCircle2 className={cls} /> : <AlertCircle className={cls} />;
}

/**
 * One centered line under the party: what's going on and, when you can't
 * queue, why and what to do instead (desktop; phones use the sticky bar).
 */
export function StatusLine({ ui, error }: { ui: QueueUi; error: string | null }) {
  const tone = toneOf(ui);
  const color =
    tone === "good" ? "text-hl-green" : tone === "warn" ? "text-hl-warn" : "text-white/70";
  return (
    <div className="flex flex-col items-center gap-1 text-center" aria-live="polite">
      <div className={`inline-flex items-center gap-2 text-sm font-black ${color}`}>
        <StatusIcon ui={ui} />
        <span className="text-white">{ui.headline}</span>
      </div>
      {ui.detail ? <div className="max-w-xl text-[0.875rem] text-white/60">{ui.detail}</div> : null}
      {ui.secondary ? (
        <Link href={ui.secondary.href} className="text-[0.875rem] font-bold text-white underline-offset-2 hover:underline">
          {ui.secondary.label} →
        </Link>
      ) : null}
      {error ? (
        <div role="alert" className="mt-1 inline-flex items-start gap-2 rounded-lg border border-hl-red/30 bg-hl-red/10 px-3 py-1.5 text-[0.875rem] text-hl-red">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Phones: the action pinned above the tab bar, always one tap away. */
export function ActionBar({
  ui,
  error,
  discordInvite,
  onFind,
  onCancel,
  elapsed,
}: {
  ui: QueueUi;
  error: string | null;
  discordInvite: string | null;
  onFind: () => void;
  onCancel: () => void;
  /** Search timer while searching. */
  elapsed?: string | null;
}) {
  return (
    <div className="queue-sticky-bar -mx-4 mt-5 border-t border-white/[0.08] bg-[#121212]/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 lg:hidden">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <div className="truncate text-sm font-black text-white">
            {ui.headline}
            {elapsed ? <span className="stat-number ml-2 text-hl-green">{elapsed}</span> : null}
          </div>
          {error ? <div className="truncate text-xs text-hl-red">{error}</div> : null}
        </div>
        <PrimaryButton ui={ui} discordInvite={discordInvite} onFind={onFind} onCancel={onCancel} size="bar" />
      </div>
    </div>
  );
}

/** The state's primary button: Find match, Cancel, Log in, Join the Discord, Open match room. */
export function PrimaryButton({
  ui,
  discordInvite,
  onFind,
  onCancel,
  size,
}: {
  ui: QueueUi;
  discordInvite: string | null;
  onFind: () => void;
  onCancel: () => void;
  size: "bar" | "panel";
}) {
  const dims = size === "bar" ? "px-5 py-3 text-sm" : "min-w-[15rem] px-10 py-3.5 text-lg tracking-wide";
  const base = `header-caps inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-black transition-all ${dims}`;
  const { action, label, disabled } = ui.primary;

  if (action === "login") {
    // A plain <a>: login must never be prefetched (see bugfixes: side-effecting GETs).
    return (
      <a href="/api/auth/discord" className={`${base} find-match-btn text-hl-base`}>
        {size === "panel" ? "Log in to play" : label}
      </a>
    );
  }
  if ((action === "join_discord" || action === "verify") && discordInvite) {
    return (
      <a href={discordInvite} target="_blank" rel="noopener noreferrer" className={`${base} bg-[#5865F2] text-white hover:bg-[#4752c4]`}>
        {label}
      </a>
    );
  }
  if (action === "open_match") {
    return (
      <Link href="/match/live" className={`${base} bg-hl-green text-hl-base hover:brightness-110`}>
        {label}
      </Link>
    );
  }
  if (action === "cancel") {
    return (
      <button type="button" onClick={onCancel} disabled={disabled} className={`${base} border border-hl-red/50 bg-[#2a1414] text-hl-red hover:bg-[#361818] disabled:opacity-50`}>
        {label}
      </button>
    );
  }
  const off = disabled || action !== "find";
  return (
    <button
      type="button"
      onClick={action === "find" ? onFind : undefined}
      disabled={off}
      className={`${base} ${off ? "cursor-not-allowed border border-white/[0.1] bg-[#2a2a2a] text-white/40" : "find-match-btn text-hl-base"}`}
    >
      {label}
    </button>
  );
}
