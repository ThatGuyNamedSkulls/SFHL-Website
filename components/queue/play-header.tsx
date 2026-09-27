"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { Flag } from "@/components/flag";
import { RANK_TIERS } from "@/data/ranks";
import { countryName, flagPath } from "@/lib/countries";
import { levelOf } from "@/lib/league-find-rules";
import type { MeView } from "@/components/queue/use-queue-state";
import type { MissionView } from "@/lib/mission-types";

const chip = "rounded-md bg-white/[0.07] px-2 py-0.5 text-[11px] font-bold text-white/75";

/** Left block: rank, Elo, progress through the current rank (FACEIT's level bar). */
function StatsBlock({ me, signedIn }: { me: MeView | null; signedIn: boolean }) {
  const p = me?.player ?? null;
  if (!p) {
    return (
      <div className="flex items-center gap-4">
        <RankBadge rank="UNRANKED" size="lg" />
        <div className="min-w-0">
          <div className="flex gap-2">{me ? <span className={chip}>{me.season.label}</span> : null}</div>
          <div className="mt-1.5 text-lg font-black text-white">{signedIn ? "Setting up your profile" : "Ranked 5v5 Strike Force"}</div>
          <div className="text-xs text-white/60">
            {signedIn ? "Your rank shows here once your player profile exists." : "Log in to get a rank, climb and earn prestige."}
          </div>
        </div>
      </div>
    );
  }
  const placed = p.placementDone && p.elo > 0;
  const tier = placed ? RANK_TIERS.find((t) => t.letter !== "UNRANKED" && p.elo >= t.minElo && p.elo <= t.maxElo) : undefined;
  const next = tier ? RANK_TIERS[RANK_TIERS.indexOf(tier) + 1] : undefined;
  const top = !!tier && tier.maxElo >= 9999;
  const fill = tier && !top ? Math.min(1, Math.max(0, (p.elo - tier.minElo) / (tier.maxElo + 1 - tier.minElo))) : 1;
  const total = me!.placementTotal;
  return (
    <div className="flex items-center gap-4">
      <RankBadge rank={placed ? p.rank : "UNRANKED"} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <span className={chip}>{me!.season.label}</span>
            {me!.prestige ? <span className={chip}>S{me!.season.number} Prestige Path</span> : null}
          </div>
          {placed && p.position ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-black text-white/80" title="Leaderboard position">
              #{p.position.toLocaleString("en-US")}
              {p.country ? <Flag src={flagPath(p.country)} name={countryName(p.country)} className="h-3 w-4" /> : null}
            </span>
          ) : null}
        </div>
        {placed ? (
          <>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="stat-number text-2xl font-black text-white">{p.elo.toLocaleString("en-US")}</span>
              <span className="text-xs font-bold text-white/55">Elo · Level {levelOf(p.elo)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#cc4400] to-hl-gold" style={{ width: `${fill * 100}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-white/50">
              <span className="stat-number">{tier?.minElo.toLocaleString("en-US")}</span>
              <span>{next && !top ? `+${Math.max(0, next.minElo - p.elo)} to ${next.name}` : "Top rank"}</span>
              <span className="stat-number">{top ? `peak ${p.peakElo.toLocaleString("en-US")}` : tier?.maxElo.toLocaleString("en-US")}</span>
            </div>
          </>
        ) : (
          <>
            <div className="mt-1 text-2xl font-black text-white">Unranked</div>
            <div className="mt-2 flex gap-1" aria-label={`${p.placementPlayed} of ${total} placement matches`}>
              {Array.from({ length: total }).map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i < p.placementPlayed ? "bg-hl-gold" : "bg-white/[0.1]"}`} />
              ))}
            </div>
            <div className="mt-1 text-[11px] text-white/55">
              {Math.max(0, total - p.placementPlayed)} placement {total - p.placementPlayed === 1 ? "match" : "matches"} left to get your rank
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Middle card: the season prestige path (every 20 wins, up to Prestige 5). */
function PrestigeCard({ me }: { me: MeView }) {
  const pr = me.prestige;
  if (!pr) return null;
  return (
    <div className="relative overflow-hidden rounded-xl border border-hl-gold/25 bg-[linear-gradient(120deg,#2a1206,#151515_70%)] p-3.5">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#ff8a4d]">
        {me.season.label} prestige path
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {Array.from({ length: pr.maxLevel }).map((_, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- static SVG badge
            <img
              key={i}
              src={`/badges/prestige-${i + 1}.svg`}
              alt={`Prestige ${i + 1}${i < pr.level ? " (reached)" : ""}`}
              title={`Prestige ${i + 1}: ${(i + 1) * pr.winsPerLevel} wins`}
              className={`h-8 w-8 ${i < pr.level ? "" : "opacity-25 grayscale"}`}
            />
          ))}
        </div>
        <div className="text-right">
          <div className="text-sm font-black text-white">{pr.level ? `Prestige ${pr.level}` : "Prestige 0"}</div>
          <div className="text-[11px] text-white/55">
            {pr.maxed ? "Max this season" : `${pr.winsIntoLevel}/${pr.winsPerLevel} wins`}
          </div>
        </div>
      </div>
      {!pr.maxed ? (
        <>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-hl-gold" style={{ width: `${(pr.winsIntoLevel / pr.winsPerLevel) * 100}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-white/60">
            Next: badge +<Coins className="h-3 w-3 text-[#f5c518]" />
            <b className="text-white">{pr.coinsPerLevel}</b>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Pick the mission worth showing: claimable first, then the closest to done. */
function pickMission(list: MissionView[]): MissionView | null {
  const live = list.filter((m) => m.tab === "ongoing" && !m.claimed);
  const claimable = live.find((m) => m.claimable);
  if (claimable) return claimable;
  return [...live].sort((a, b) => b.progress / b.goal - a.progress / a.goal)[0] ?? null;
}

/** Right card: your current mission, with Claim reward when it's done. */
function MissionCard({ season }: { season: number }) {
  const [mission, setMission] = useState<MissionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/missions", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { missions?: MissionView[] }) : null;
    setMission(pickMission(data?.missions ?? []));
  };
  useEffect(() => {
    let alive = true;
    fetch("/api/missions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { missions?: MissionView[] } | null) => {
        if (alive) setMission(pickMission(d?.missions ?? []));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const claim = async () => {
    if (!mission || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: mission.id }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(res.ok ? `+${data.reward ?? mission.rewardCoins} HL Coins` : data.error || "Couldn't claim.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!mission) {
    return (
      <Link href="/missions" className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#151515] p-3.5 hover:border-white/25">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/55">Missions</div>
          <div className="mt-1 text-sm font-black text-white">{note ?? "All caught up"}</div>
        </div>
        <span className="text-xs font-bold text-white/60">View →</span>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#151515] p-3.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-white/55">
          {/* "S1 Monthly mission: Weekly Grind" — no repeat when the title already says it. */}
          S{season} {mission.category} mission
          {/mission/i.test(mission.title) ? "" : `: ${mission.title}`}
        </div>
        <div className="mt-1 truncate text-sm font-black text-white">{mission.description}</div>
        {mission.endsInLabel ? <div className="text-[11px] text-white/50">{mission.endsInLabel}</div> : null}
        {mission.claimable ? (
          <button type="button" onClick={claim} disabled={busy} className="mt-1 text-xs font-black uppercase tracking-wide text-hl-gold hover:text-[#ff7733]">
            {busy ? "Claiming…" : "Claim reward"}
          </button>
        ) : (
          <div className="mt-1 text-xs text-white/60">
            {note ?? (
              <>
                <b className="stat-number text-white">{mission.progress}</b>/{mission.goal}
              </>
            )}
          </div>
        )}
      </div>
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-white/[0.1] bg-black/30 text-center">
        <div>
          <Coins className="mx-auto h-4 w-4 text-[#f5c518]" />
          <div className="stat-number text-xs font-black text-white">{mission.rewardCoins}</div>
        </div>
      </div>
    </div>
  );
}

/** FACEIT-style top strip: you · prestige path · mission. */
export function PlayHeader({ me, signedIn }: { me: MeView | null; signedIn: boolean }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
      <StatsBlock me={me} signedIn={signedIn} />
      {me?.player && me.prestige ? <PrestigeCard me={me} /> : <div className="hidden lg:block" />}
      {signedIn && me?.player ? <MissionCard season={me.season.number} /> : null}
    </section>
  );
}
