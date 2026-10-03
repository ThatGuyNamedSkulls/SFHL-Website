"use client";

import { useState } from "react";
import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { useClan } from "@/components/clans/clan-context";
import { Medal, PANEL, PlayerAvatar, TaggedName } from "@/components/clans/ui";
import type { ClanMember } from "@/components/clans/types";
import { kdOf } from "@/lib/clan-ui";
import { profileHref } from "@/lib/profile-link";
import type { RankTierLetter } from "@/types";

type Metric = "elo" | "wins" | "matches" | "kd";
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: "elo", label: "Elo", unit: "Elo" },
  { id: "wins", label: "Wins", unit: "wins this season" },
  { id: "matches", label: "Matches", unit: "matches this season" },
  { id: "kd", label: "K/D", unit: "K/D this season" },
];
const EDGE = ["border-t-[#d9b25f]/75", "border-t-[#bebebe]/55", "border-t-[#c08457]/65"];
const COLS = "grid-cols-[1.75rem_minmax(0,1fr)_5rem] md:grid-cols-[2.75rem_minmax(0,2fr)_6.25rem_6.25rem_6.25rem_5.625rem_5rem]";

function valueOf(m: ClanMember, metric: Metric): number {
  if (metric === "elo") return m.placementDone ? m.elo : 0;
  if (metric === "wins") return m.season.wins;
  if (metric === "matches") return m.season.matches;
  return kdOf(m.season.kills, m.season.deaths, m.season.matches) ?? 0;
}

function shown(m: ClanMember, metric: Metric): string {
  if (metric === "elo") return m.placementDone ? m.elo.toLocaleString() : "—";
  if (metric === "kd") {
    const kd = kdOf(m.season.kills, m.season.deaths, m.season.matches);
    return kd == null ? "—" : kd.toFixed(2);
  }
  return String(valueOf(m, metric));
}

/**
 * Leaderboard (§4.11, Q3): the top three as cards, then a table, ranked by Elo,
 * or by this season's wins, matches or K/D.
 */
export function LeaderboardTab() {
  const { data, isOnline } = useClan();
  const club = data.club;
  const [metric, setMetric] = useState<Metric>("elo");
  const rows = club.members
    .filter((m) => (metric === "elo" ? m.placementDone && m.elo > 0 : true))
    .sort(
      (a, b) =>
        valueOf(b, metric) - valueOf(a, metric) ||
        b.season.matches - a.season.matches ||
        (a.playerName || a.username).localeCompare(b.playerName || b.username)
    );
  const unit = METRICS.find((x) => x.id === metric)!.unit;
  const since = data.season.startedAt
    ? new Date(`${data.season.startedAt.replace(" ", "T")}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  const nameLink = (m: ClanMember, cls: string) => {
    const name = m.playerName || m.username;
    return m.playerName ? (
      <Link href={profileHref(m.playerName)} className={`${cls} hover:text-white`}>
        <TaggedName tag={club.tag} name={name} />
      </Link>
    ) : (
      <b className={cls}>
        <TaggedName tag={club.tag} name={name} />
      </b>
    );
  };
  const col = (id: Metric) => (metric === id ? "font-bold text-[#ededed]" : "text-[#bdbdbd]");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex overflow-hidden rounded-lg border border-white/[0.07]" role="group" aria-label="Rank by">
          {METRICS.map((x, i) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setMetric(x.id)}
              aria-pressed={metric === x.id}
              className={`h-[2.125rem] px-3 text-[0.8125rem] font-medium ${i ? "border-l border-white/[0.07]" : ""} ${
                metric === x.id ? "bg-[#262626] text-[#ededed]" : "bg-[#141414] text-[#8a8a8a] hover:text-white"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[#8a8a8a]">
          {metric === "elo"
            ? "Ranked members by current Elo"
            : `Ranked matches ${since ? `this season (since ${since})` : "so far"}, by ${METRICS.find((x) => x.id === metric)!.label}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={`${PANEL} px-5 py-10 text-center text-sm text-[#8a8a8a]`}>
          {metric === "elo" ? "No member has finished placement yet." : "No ranked matches this season yet."}
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-3 md:gap-3">
            {rows.slice(0, 3).map((m, i) => {
              const name = m.playerName || m.username;
              return (
                <div key={m.discordId} className={`${PANEL} flex items-center gap-2.5 border-t-2 px-3 py-2.5 md:gap-3 md:px-4 md:py-3.5 ${EDGE[i]}`}>
                  <Medal n={i + 1} />
                  <PlayerAvatar name={name} src={m.avatar} size={40} online={isOnline({ name })} />
                  <span className="min-w-0 flex-1">
                    {nameLink(m, "block truncate font-bold text-[#ededed]")}
                    <small className="mt-0.5 hidden items-center gap-1.5 text-xs text-[#8a8a8a] md:flex">
                      <RankBadge rank={(m.placementDone ? m.rank : "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-4 !w-4" />
                      {metric === "elo" ? `${m.season.matches} matches this season` : m.placementDone ? `${m.elo.toLocaleString()} Elo` : "In placement"}
                    </small>
                  </span>
                  <span className="text-right text-lg font-extrabold tabular-nums text-[#ededed] md:text-[1.375rem]">
                    {shown(m, metric)}
                    <small className="block text-[0.6875rem] font-medium text-[#8a8a8a]">{unit}</small>
                  </span>
                </div>
              );
            })}
          </div>

          {rows.length > 3 ? (
            <section className={PANEL}>
              <div className={`hidden h-[2.375rem] items-center gap-3.5 border-b border-white/[0.07] px-4 text-xs font-medium text-[#8a8a8a] md:grid ${COLS}`}>
                <span className="text-center">#</span>
                <span>Player</span>
                <span className={`text-right ${metric === "elo" ? "text-[#ededed]" : ""}`}>Elo</span>
                <span className={`text-right ${metric === "wins" ? "text-[#ededed]" : ""}`}>Wins</span>
                <span className={`text-right ${metric === "matches" ? "text-[#ededed]" : ""}`}>Matches</span>
                <span className="text-right">Win rate</span>
                <span className={`text-right ${metric === "kd" ? "text-[#ededed]" : ""}`}>K/D</span>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {rows.slice(3).map((m, j) => {
                  const name = m.playerName || m.username;
                  const s = m.season;
                  const kd = kdOf(s.kills, s.deaths, s.matches);
                  return (
                    <div key={m.discordId} className={`grid min-h-[3.25rem] items-center gap-3.5 px-3.5 md:px-4 ${COLS}`}>
                      <span className="text-center font-bold tabular-nums text-[#8a8a8a]">{j + 4}</span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <PlayerAvatar name={name} src={m.avatar} size={30} online={isOnline({ name })} />
                        <span className="hidden md:inline-flex">
                          <RankBadge rank={(m.placementDone ? m.rank : "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5" />
                        </span>
                        {nameLink(m, "truncate font-semibold text-[#ededed]")}
                      </span>
                      <span className={`text-right tabular-nums md:hidden ${col(metric)}`}>{shown(m, metric)}</span>
                      <span className={`hidden text-right tabular-nums md:block ${col("elo")}`}>{m.placementDone ? m.elo.toLocaleString() : "—"}</span>
                      <span className={`hidden text-right tabular-nums md:block ${col("wins")}`}>{s.wins}</span>
                      <span className={`hidden text-right tabular-nums md:block ${col("matches")}`}>{s.matches}</span>
                      <span className="hidden text-right tabular-nums text-[#bdbdbd] md:block">
                        {s.matches ? `${Math.round((s.wins / s.matches) * 100)}%` : "—"}
                      </span>
                      <span className={`hidden text-right tabular-nums md:block ${col("kd")}`}>{kd == null ? "—" : kd.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
