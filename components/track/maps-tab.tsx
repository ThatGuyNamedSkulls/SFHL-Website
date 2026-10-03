"use client";

import { Map as MapIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MapThumb } from "@/components/map-thumb";
import { formatSigned, ratingColor } from "@/lib/match-stats";
import type { WindowTotals } from "@/lib/profile-stats";
import { MAP_TAG_MIN, type MapSummary } from "@/lib/track-stats";

/** "▲ 0.12" / "▼ 4%" against the range average, or "= avg". */
function Compare({ value, average, digits, unit = "" }: { value: number | null; average: number | null; digits: number; unit?: string }) {
  if (value == null || average == null) return null;
  const diff = value - average;
  if (Math.abs(diff) < 0.5 * 10 ** -digits) return <span className="text-[0.6875rem] font-bold text-[#8a8a8a]">= avg</span>;
  return (
    <span className={`text-[0.6875rem] font-bold ${diff > 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(digits)}
      {unit}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[0.8125rem] text-[#c8c8c8]">
      <span>{label}</span>
      <b className="inline-flex items-center gap-1.5 tabular-nums text-white">{children}</b>
    </div>
  );
}

/**
 * Maps (§4.11): a card per map played in the range, each stat against the
 * player's own average for the range, with "Best map" / "Needs work" tags.
 */
export function MapsTab({ maps, all }: { maps: MapSummary[]; all: WindowTotals }) {
  if (maps.length === 0) {
    return (
      <div className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
        <EmptyState icon={MapIcon} title="No matches in this range" hint="Try a longer range." />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[1.375rem] font-black text-white">Maps</h2>
        <span className="text-xs text-[#8a8a8a]">
          {maps.length} {maps.length === 1 ? "map" : "maps"} in {all.matches} matches · compared with the range average · tags
          need {MAP_TAG_MIN}+ matches
        </span>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {maps.map(({ map, totals: t, tag }) => (
          <section key={map} className="overflow-hidden rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c]">
            <div className="relative flex h-[5.25rem] items-end px-3.5 py-3">
              <MapThumb map={map} className="!absolute inset-0 !rounded-none" />
              <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_20%,rgba(28,28,28,0.95))]" />
              {tag ? (
                <span
                  className={`absolute right-2.5 top-2.5 z-[1] rounded-md border px-2 py-[3px] text-[0.625rem] font-black uppercase tracking-[0.1em] ${
                    tag === "best"
                      ? "border-[#2ecc71]/45 bg-[#2ecc71]/20 text-[#2ecc71]"
                      : "border-[#e74c3c]/45 bg-[#e74c3c]/20 text-[#e74c3c]"
                  }`}
                >
                  {tag === "best" ? "Best map" : "Needs work"}
                </span>
              ) : null}
              <h3 className="relative z-[1] text-lg font-black text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.5)]">{map}</h3>
            </div>
            <div className="mx-3.5 mt-2.5 h-[5px] overflow-hidden rounded-full bg-[#2a2a2a]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${t.winPercent}%`, background: t.winPercent >= 50 ? "#2ecc71" : "#e74c3c" }}
              />
            </div>
            <div className="divide-y divide-white/[0.05] px-3.5 pb-3 pt-1.5">
              <Row label="Matches">
                {t.matches}
                <span className="font-semibold text-[#8a8a8a]">
                  · {t.wins}–{t.losses}
                </span>
              </Row>
              <Row label="Win rate">
                {Math.round(t.winPercent)}%
                <Compare value={t.winPercent} average={all.winPercent} digits={0} unit="%" />
              </Row>
              <Row label="K/D">
                {t.kd.toFixed(2)}
                <Compare value={t.kd} average={all.kd} digits={2} />
              </Row>
              <Row label="ADR">
                {t.adr != null ? t.adr.toFixed(1) : "—"}
                <Compare value={t.adr} average={all.adr} digits={1} />
              </Row>
              <Row label="Rating">
                <span style={{ color: ratingColor(t.rating) }}>{t.rating.toFixed(2)}</span>
                <Compare value={t.rating} average={all.rating} digits={2} />
              </Row>
              <Row label="Elo">
                <span className={t.eloChange >= 0 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{formatSigned(t.eloChange)}</span>
              </Row>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
