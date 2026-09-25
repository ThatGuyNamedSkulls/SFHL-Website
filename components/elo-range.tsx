"use client";

/**
 * Skill level / Elo range picker (docs/LEAGUE_V2_PLAN.md D3, FACEIT-style):
 * a two-handle slider over levels 1–10 (the rank tiers D … ★) — dragging a
 * handle snaps the range to that level's floor or ceiling — and two number
 * boxes (100–9999) for an exact Elo. `EloRangeFields` is the controlled body
 * (the team post editor uses it); `EloRangeFilter` is the board's popover.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { ELO_FLOOR, ELO_MAX, LEVELS, cleanRange, levelBounds, rangeLabel, rangeLevels } from "@/lib/league-find-rules";
import type { RankTierLetter } from "@/types";

export interface EloRange {
  minElo: number | null;
  maxElo: number | null;
}

const THUMB =
  "pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent " +
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-grab " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] " +
  "[&::-webkit-slider-thumb]:border-[#ff5500] [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-grab " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-[#ff5500] [&::-moz-range-thumb]:bg-white " +
  "focus-visible:outline-none focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-white/60";

function EloBox({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder: number;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [synced, setSynced] = useState(value);
  // The handles moved: show their value (adjusting state while rendering, not in an effect).
  if (synced !== value) {
    setSynced(value);
    setText(value === null ? "" : String(value));
  }
  const commit = () => {
    const t = text.trim();
    if (!t) return onCommit(null);
    const n = Number(t);
    if (Number.isFinite(n)) onCommit(n);
    else setText(value === null ? "" : String(value));
  };
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={ELO_FLOOR}
        max={ELO_MAX}
        value={text}
        placeholder={String(placeholder)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-10 w-full rounded-lg border border-white/[0.12] bg-[#1b1b1b] px-3 text-sm font-bold tabular-nums text-white outline-none placeholder:text-white/35 focus:border-[#ff5500]"
      />
    </label>
  );
}

/** The slider + boxes, controlled. */
export function EloRangeFields({ value, onChange }: { value: EloRange; onChange: (v: EloRange) => void }) {
  const [lo, hi] = rangeLevels(value.minElo, value.maxElo);
  const n = LEVELS.length;
  const pct = (level: number) => ((level - 1) / (n - 1)) * 100;
  const drag = (which: "lo" | "hi", level: number) => {
    const a = which === "lo" ? Math.min(level, hi) : lo;
    const b = which === "hi" ? Math.max(level, lo) : hi;
    const bounds = levelBounds(a, b);
    // Only the dragged end snaps; the other end keeps an exact Elo if one was typed.
    onChange(
      cleanRange(which === "lo" ? bounds.minElo : value.minElo, which === "hi" ? bounds.maxElo : value.maxElo)
    );
  };
  return (
    <div className="space-y-4">
      <div className="px-2.5">
        <div className="relative h-5">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/[0.1]" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#ff5500]"
            style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
          />
          {LEVELS.map((l) => (
            <span
              key={l.level}
              aria-hidden
              className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                l.level >= lo && l.level <= hi ? "bg-white" : "bg-white/25"
              }`}
              style={{ left: `${pct(l.level)}%` }}
            />
          ))}
          <input
            type="range"
            min={1}
            max={n}
            step={1}
            value={lo}
            aria-label="Lowest skill level"
            aria-valuetext={`Level ${lo}`}
            onChange={(e) => drag("lo", Number(e.target.value))}
            className={`${THUMB} ${lo === n ? "z-20" : "z-10"}`}
          />
          <input
            type="range"
            min={1}
            max={n}
            step={1}
            value={hi}
            aria-label="Highest skill level"
            aria-valuetext={`Level ${hi}`}
            onChange={(e) => drag("hi", Number(e.target.value))}
            className={`${THUMB} z-10`}
          />
        </div>
        <div className="relative mt-2 h-9">
          {LEVELS.map((l) => (
            <span
              key={l.level}
              className={`absolute flex -translate-x-1/2 flex-col items-center ${l.level >= lo && l.level <= hi ? "" : "opacity-40"}`}
              style={{ left: `${pct(l.level)}%` }}
              title={`Level ${l.level}: ${l.min.toLocaleString("en-US")}–${l.max.toLocaleString("en-US")} Elo`}
            >
              <RankBadge rank={l.letter as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5" />
              <span className="text-[9px] font-bold tabular-nums text-white/55">{l.level}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <EloBox label="Min Elo" value={value.minElo} placeholder={ELO_FLOOR} onCommit={(v) => onChange(cleanRange(v, value.maxElo))} />
        <span className="pb-2.5 text-white/40">–</span>
        <EloBox label="Max Elo" value={value.maxElo} placeholder={ELO_MAX} onCommit={(v) => onChange(cleanRange(value.minElo, v))} />
      </div>
    </div>
  );
}

/** The board filter: a button that opens the picker; Apply sets ?minElo=&maxElo=. */
export function EloRangeFilter({ value, onApply }: { value: EloRange; onApply: (v: EloRange) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EloRange>(value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = value.minElo !== null || value.maxElo !== null;
  return (
    <div ref={ref} className="relative">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Skill level</span>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setDraft(value);
          setOpen((o) => !o);
        }}
        className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-bold ${
          active ? "border-[#ff5500]/60 bg-[#ff5500]/10 text-white" : "border-white/[0.12] bg-[#1b1b1b] text-white/80"
        }`}
      >
        <Gauge className="h-4 w-4 text-[#ff5500]" />
        {rangeLabel(value)}
        <ChevronDown className="h-4 w-4 text-white/50" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Select skill level or Elo range"
          className="absolute left-0 z-40 mt-2 w-[min(92vw,380px)] rounded-xl border border-white/10 bg-[#161616] p-4 shadow-2xl"
        >
          <div className="mb-3 text-sm font-black text-white">Select skill level / Elo range</div>
          <EloRangeFields value={draft} onChange={setDraft} />
          <div className="mt-4 flex justify-between gap-2">
            <button
              type="button"
              onClick={() => setDraft({ minElo: null, maxElo: null })}
              className="h-9 rounded-lg px-3 text-xs font-black uppercase tracking-wide text-white/60 hover:text-white"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
              className="find-match-btn h-9 rounded-lg px-5 text-xs font-black uppercase tracking-wide text-hl-base"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
