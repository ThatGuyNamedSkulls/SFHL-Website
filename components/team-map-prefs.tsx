"use client";

/**
 * Team page "Game preferences" (docs/LEAGUE_V2_PLAN.md D4): maps the team (or
 * one player, via the chips) played in league matches, with matches and win
 * rate. Win rate is a single measure, so it's one hue (a thin bar).
 */
import { useState } from "react";
import type { MapPref } from "@/lib/team-stats";

function MapThumb({ map }: { map: string }) {
  const initials = map
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="grid h-8 w-12 shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#2a2a2a] to-[#161616] text-[10px] font-black text-white/60">
      {initials}
    </span>
  );
}

export function TeamMapPrefs({ team, players }: { team: MapPref[]; players: Record<string, MapPref[]> }) {
  const [who, setWho] = useState<string | null>(null);
  const rows = who ? players[who] ?? [] : team;
  const names = Object.keys(players).sort((a, b) => a.localeCompare(b));
  const chip = (on: boolean) =>
    `h-8 rounded-full border px-3 text-xs font-bold ${
      on ? "border-[#ff5500] bg-[#ff5500]/15 text-white" : "border-white/[0.1] text-white/60 hover:text-white"
    }`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Whose maps">
        <button type="button" aria-pressed={who === null} onClick={() => setWho(null)} className={chip(who === null)}>
          Team
        </button>
        {names.map((n) => (
          <button key={n} type="button" aria-pressed={who === n} onClick={() => setWho(n)} className={chip(who === n)}>
            {n}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/50">No maps yet: they come from the saved scoreboards.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-white/45">
              <th className="pb-2 font-semibold">Map</th>
              <th className="pb-2 text-right font-semibold">Matches</th>
              <th className="w-[45%] pb-2 pl-4 font-semibold">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.map} className="border-t border-white/[0.05]">
                <td className="py-2">
                  <span className="flex items-center gap-3">
                    <MapThumb map={r.map} />
                    <span className="font-bold text-white">{r.map}</span>
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums text-white/80">{r.played}</td>
                <td className="py-2 pl-4">
                  <span className="flex items-center gap-2" title={`${r.wins} won of ${r.played}`}>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                      <span className="block h-full rounded-full bg-[#ff5500]" style={{ width: `${r.winRate}%` }} />
                    </span>
                    <span className="w-10 text-right text-xs font-bold tabular-nums text-white/85">{r.winRate}%</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
