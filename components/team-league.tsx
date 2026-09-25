/**
 * The team page's League section (docs/LEAGUE_V2_PLAN.md C4): where the team
 * plays next season (its earned status, or its Open band by skill), its place
 * on the promotion ladder, and every season with its record, final place,
 * move and prize. No hooks, so the client team page can render it.
 */
import Link from "next/link";
import { ChevronRight, Coins, Lock, Trophy } from "lucide-react";
import { MovePill } from "@/components/league-move-pill";
import type { TeamLeagueSeason, TeamLeagueStatus } from "@/lib/league";
import { LEVEL_NAMES, ordinal } from "@/lib/league-standings";

/** Open 8-9 feeds Open 10, then the earned ladder (lib/league-swiss.ts LADDER). */
const CLIMB = ["open89", "open10", "entry", "intermediate", "main", "advanced", "pro"];
const PODIUM = ["text-hl-gold", "text-[#c9d1d9]", "text-[#d08a4a]"];

function statusNote(status: TeamLeagueStatus, seasons: TeamLeagueSeason[]): string {
  const last = seasons.find((s) => s.movement);
  const after = last ? ` after ${last.season}` : "";
  if (status.bySkill) {
    const elo = status.seedElo ? ` · ${status.seedElo.toLocaleString("en-US")} Elo (top-5 average)` : "";
    return `No earned status: placed by skill${elo}`;
  }
  if (!status.earned) return "Set by Match Staff";
  if (last?.movement === "up") return `Promoted${after}`;
  if (last?.movement === "down") return `Relegated${after}`;
  return "Earned by promotion";
}

function StatusLadder({ code }: { code: string }) {
  const at = CLIMB.indexOf(code);
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Promotion ladder">
      {CLIMB.map((c, i) => (
        <li key={c} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight aria-hidden className="h-3 w-3 text-white/25" /> : null}
          <span
            aria-current={i === at ? "step" : undefined}
            className={`rounded-md px-2 py-0.5 text-[11px] font-black ${
              i === at
                ? "bg-[#ff5500] text-white"
                : i < at
                  ? "bg-white/[0.06] text-white/55"
                  : "border border-white/[0.08] text-white/40"
            }`}
          >
            {LEVEL_NAMES[c]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function placeText(s: TeamLeagueSeason): React.ReactNode {
  if (s.finalPlace) {
    return (
      <span className={`font-black ${PODIUM[s.finalPlace - 1] ?? "text-white"}`}>
        {s.finalPlace === 1 ? (
          <span className="inline-flex items-center gap-1">
            <Trophy className="h-3.5 w-3.5" /> Champions
          </span>
        ) : (
          ordinal(s.finalPlace)
        )}
        {s.teams && s.finalPlace > 1 ? <span className="ml-1 font-semibold text-white/45">of {s.teams}</span> : null}
      </span>
    );
  }
  if (!s.placed) return <span className="text-white/45">{s.seasonStatus === "finished" ? "Not placed" : "Signed up"}</span>;
  if (s.seasonStatus === "finished") return <span className="text-white/45">—</span>;
  return <span className="font-bold text-[#ff5500]">In progress</span>;
}

export function TeamLeague({
  status,
  seasons,
  staffControl,
  records = true,
}: {
  status: TeamLeagueStatus | null;
  seasons: TeamLeagueSeason[];
  /** Match Staff: the status select. */
  staffControl?: React.ReactNode;
  /** The season records list (the team page's League tab has its own season picker). */
  records?: boolean;
}) {
  const climbing = status ? CLIMB.includes(status.code) : false;
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#121212]">
      <div className={`flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5 ${records ? "border-b border-white/[0.06]" : ""}`}>
        <div className="min-w-0 space-y-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">League status · next season</div>
          {status ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {!status.bySkill ? <Lock className="h-4 w-4 text-[#ff5500]" /> : null}
                <span className="text-xl font-black text-white">
                  {status.name}
                  {status.bySkill ? "" : " status"}
                </span>
              </div>
              <div className="text-xs text-white/60">{statusNote(status, seasons)}</div>
              {climbing ? (
                <StatusLadder code={status.code} />
              ) : (
                <div className="text-[11px] text-white/45">
                  {status.name} is placed by skill each season and has no promotion. Teams reach Open 8-9 by skill, then climb.
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-white/55">Unknown</div>
          )}
        </div>
        {staffControl ? <div className="shrink-0">{staffControl}</div> : null}
      </div>

      {records ? (
      <div className="p-4 sm:p-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">Season records</div>
        {seasons.length === 0 ? (
          <p className="text-xs text-white/50">No league seasons yet. The captain signs the team up on the League page.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {seasons.map((s) => (
              <li
                key={s.seasonId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_90px_120px_minmax(150px,auto)_80px]"
              >
                <div className="min-w-0">
                  <Link href={`/league/${s.seasonId}`} className="text-sm font-black text-white hover:underline">
                    {s.season}
                  </Link>
                  {s.division ? (
                    <Link
                      href={s.divisionId ? `/league/${s.seasonId}/standings?division=${s.divisionId}` : `/league/${s.seasonId}/standings`}
                      className="block truncate text-xs font-semibold text-white/55 hover:text-white"
                    >
                      {s.division}
                    </Link>
                  ) : null}
                </div>
                <div className="text-right text-xs tabular-nums text-white/75 sm:text-left">
                  {s.placed ? (
                    <>
                      <span className="font-black text-hl-green">{s.won}W</span>
                      <span className="text-white/35"> – </span>
                      <span className="font-black text-hl-red">{s.lost}L</span>
                    </>
                  ) : null}
                </div>
                <div className="text-xs">{placeText(s)}</div>
                <div className="flex justify-end sm:justify-start">
                  {s.movement ? <MovePill movement={s.movement} to={s.movedTo ?? ""} /> : null}
                </div>
                <div className={`col-span-2 text-xs sm:col-span-1 sm:block sm:text-right ${s.prize ? "" : "hidden"}`}>
                  {s.prize ? (
                    <span className="inline-flex items-center gap-1 font-bold text-hl-gold">
                      <Coins className="h-3.5 w-3.5" /> {s.prize.toLocaleString("en-US")}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      ) : null}
    </section>
  );
}
