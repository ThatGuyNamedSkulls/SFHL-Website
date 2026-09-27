"use client";

import type { KeyboardEvent } from "react";
import { Activity, CircleAlert, Gem, Medal, ShieldCheck, Star, Swords, Users, Zap, type LucideIcon } from "lucide-react";
import { QUEUE_REGIONS } from "@/lib/regions";
import { PRO_QUEUE_ENABLED, QUEUE_MODE_PRO, QUEUE_MODE_SUPER, SUPER_ELO_RANGE, SUPER_PARTY_MAX } from "@/lib/queue-modes";

/** Arrow keys move through a radiogroup's enabled options (WAI-ARIA pattern). */
function radioKeys(onPick: (index: number) => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const at = items.findIndex((b) => b === document.activeElement);
    for (let i = 1; i <= items.length; i++) {
      const next = items[(at + step * i + items.length * 2) % items.length];
      if (!next.disabled) {
        e.preventDefault();
        next.focus();
        onPick(items.indexOf(next));
        return;
      }
    }
  };
}

interface Feature {
  icon: LucideIcon;
  text: string;
  /** Green check box, FACEIT-style. */
  check?: boolean;
}

interface ModeDef {
  id: string;
  label: string;
  icon: LucideIcon;
  tone: "white" | "orange" | "purple";
  features: Feature[];
}

const ALL_MODES: ModeDef[] = [
  {
    id: "standard",
    label: "Standard Match",
    icon: Swords,
    tone: "white",
    features: [
      { icon: Users, text: "All party sizes" },
      { icon: ShieldCheck, text: "Verified matching", check: true },
      { icon: Activity, text: "No Elo restrictions" },
      { icon: Medal, text: "Ranked Elo", check: true },
    ],
  },
  {
    id: QUEUE_MODE_SUPER,
    label: "Super Match",
    icon: Zap,
    tone: "orange",
    features: [
      { icon: Users, text: "Solo, duo, trio" },
      { icon: ShieldCheck, text: "Verified matching", check: true },
      { icon: Activity, text: `${SUPER_ELO_RANGE} Elo range` },
      { icon: Star, text: "Ranked players only", check: true },
    ],
  },
  {
    id: QUEUE_MODE_PRO,
    label: "Pro Matchmaking",
    icon: Gem,
    tone: "purple",
    features: [
      { icon: ShieldCheck, text: "S2+ only", check: true },
      { icon: Activity, text: "Separate Pro Elo" },
    ],
  },
];
const MODES = ALL_MODES.filter((m) => PRO_QUEUE_ENABLED || m.id !== QUEUE_MODE_PRO);

/** FACEIT-style match type cards, centered (Standard + Super). */
export function ModePicker({
  value,
  onChange,
  locked,
  openModes,
  counts,
  lockReasons,
  teamSize,
}: {
  value: string;
  onChange: (mode: string) => void;
  locked: boolean;
  /** Modes open on the chosen server. */
  openModes: string[];
  counts: Record<string, number>;
  /** Mode → why it can't be picked (placements, party size, Elo). */
  lockReasons: Record<string, string | undefined>;
  teamSize: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Match type"
      onKeyDown={radioKeys((i) => onChange(MODES[i].id))}
      className="flex flex-wrap justify-center gap-4"
    >
      {MODES.map((m) => {
        const on = value === m.id;
        const reason = lockReasons[m.id];
        const disabled = (locked && !on) || (!!reason && !on);
        const open = openModes.includes(m.id);
        const Icon = m.icon;
        const title = m.tone === "orange" ? "text-hl-gold" : m.tone === "purple" ? "text-[#c084fc]" : "text-white";
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={`relative w-full overflow-hidden rounded-xl border text-left transition-colors sm:w-[340px] ${
              on ? "border-white/85 bg-hl-surface-3" : "border-white/[0.09] bg-hl-surface-2 hover:border-white/30"
            } ${disabled ? "cursor-not-allowed opacity-45 hover:border-white/[0.09]" : ""}`}
          >
            {m.tone === "orange" ? (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-hl-gold/25 to-transparent" />
            ) : null}
            <div className="relative flex items-center justify-between gap-2 px-4 pb-3 pt-3.5">
              <span className="flex min-w-0 items-center gap-2">
                <Icon className={`h-4 w-4 shrink-0 ${title}`} />
                <span className={`truncate text-[15px] font-black ${title}`}>{m.label}</span>
                <span className="shrink-0 text-xs text-white/50">
                  · {teamSize}v{teamSize}
                </span>
              </span>
              {reason ? (
                <span title={reason} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hl-warn text-hl-surface-2">
                  <CircleAlert className="h-3.5 w-3.5" />
                </span>
              ) : (
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${
                    open ? "border-hl-green/30 text-hl-green" : "border-white/10 text-white/45"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-hl-green" : "bg-white/30"}`} />
                  {open ? `${counts[m.id] ?? 0} queuing` : "Closed"}
                </span>
              )}
            </div>
            <div className="relative grid grid-cols-2 gap-2 px-4 pb-4">
              {m.features.map(({ icon: FeatureIcon, text, check }) => (
                <span key={text} className="flex min-h-[38px] items-center gap-2 rounded-md bg-white/[0.045] px-2.5 py-2">
                  <FeatureIcon className="h-3.5 w-3.5 shrink-0 text-white/55" />
                  <span className="min-w-0 flex-1 text-[11px] font-semibold leading-tight text-white/85">{text}</span>
                  {check ? (
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-hl-green text-hl-surface-2">
                      <Star className="h-2.5 w-2.5 fill-current" />
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
            {reason ? <div className="relative px-4 pb-3 text-[11px] font-bold text-hl-warn">{reason}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Server cards for the Servers tab, centered. */
export function ServerPicker({
  value,
  onChange,
  locked,
  openRegions,
  counts,
}: {
  value: string;
  onChange: (region: string) => void;
  locked: boolean;
  openRegions: string[];
  /** Players queuing per server. */
  counts: Record<string, number>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Server"
      onKeyDown={radioKeys((i) => onChange(QUEUE_REGIONS[i].id))}
      className="flex flex-wrap justify-center gap-3"
    >
      {QUEUE_REGIONS.map((r) => {
        const on = value === r.id;
        const open = openRegions.includes(r.id);
        const disabled = locked && !on;
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(r.id)}
            className={`w-[calc(50%-6px)] rounded-xl border px-4 py-3 text-left transition-colors sm:w-[190px] ${
              on ? "border-white/85 bg-hl-surface-3" : "border-white/[0.09] bg-hl-surface-2 hover:border-white/30"
            } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black text-white">{r.label}</span>
              <span className="text-[11px] font-bold text-white/50">{r.short}</span>
            </div>
            <div className={`mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold ${open ? "text-hl-green" : "text-white/45"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${open ? "animate-pulse bg-hl-green" : "bg-white/30"}`} />
              {open ? `Open · ${counts[r.id] ?? 0} queuing` : "Closed right now"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Why a mode can't be picked right now (shown on the mode card). */
export function modeLockReasons(opts: {
  selfPlacing: boolean;
  partySize: number;
  placingNames: string[];
  proEligible: boolean;
}): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (opts.selfPlacing) out[QUEUE_MODE_SUPER] = "Finish your placements to unlock";
  else if (opts.placingNames.length) out[QUEUE_MODE_SUPER] = "Everyone in the party must be ranked";
  else if (opts.partySize > SUPER_PARTY_MAX) out[QUEUE_MODE_SUPER] = `Max party of ${SUPER_PARTY_MAX}`;
  if (!opts.proEligible) out[QUEUE_MODE_PRO] = "Reach S2 (1900 Elo) to unlock";
  return out;
}
