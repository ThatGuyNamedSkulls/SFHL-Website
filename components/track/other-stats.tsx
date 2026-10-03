"use client";

import type { WindowTotals } from "@/lib/profile-stats";

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#161616] px-3.5 py-3">
      <div className="whitespace-nowrap text-xl font-black tabular-nums text-white">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs text-[#8a8a8a]">{label}</div>
    </div>
  );
}

/**
 * Other stats (§4.9): totals for the range. First kills and multi-kill rounds
 * only exist for games ranked from Counter Blox's own scoreboard, so they say
 * how many of the range's matches that is.
 */
export function OtherStats({ totals }: { totals: WindowTotals }) {
  return (
    <section className="rounded-[0.875rem] border border-white/[0.08] bg-[#1c1c1c] px-[1.125rem] py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-extrabold text-white">Other stats</h2>
        <span className="text-xs text-[#8a8a8a]">
          {totals.matches} {totals.matches === 1 ? "match" : "matches"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <Tile value={totals.wins} label="Wins" />
        <Tile value={totals.totalKills} label="Kills" />
        <Tile value={totals.totalMvps} label="MVPs" />
      </div>
      {totals.scoreboardMatches > 0 ? (
        <>
          <p className="mt-3.5 text-xs text-[#8a8a8a]">
            From Counter Blox&apos;s own scoreboard ·{" "}
            <b className="text-white">
              {totals.scoreboardMatches} of {totals.matches}
            </b>{" "}
            matches
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <Tile value={totals.firstKills} label="First kills" />
            <Tile value={totals.rounds2k} label="2K rounds" />
            <Tile value={totals.rounds3k} label="3K rounds" />
            <Tile value={totals.rounds4k} label="4K rounds" />
            <Tile value={totals.rounds5k} label="Aces" />
            <Tile value={totals.scoreboardMatches} label="Scoreboard games" />
          </div>
        </>
      ) : (
        <p className="mt-3.5 text-xs text-[#6a6a6a]">
          First kills and 2K–5K rounds show for games ranked from Counter Blox&apos;s own scoreboard.
        </p>
      )}
    </section>
  );
}
