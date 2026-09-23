"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Coins, Crosshair } from "lucide-react";
import type { MissionCategory, MissionTab, MissionView } from "@/lib/mission-types";

const TABS: { id: MissionTab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "ongoing", label: "Ongoing" },
  { id: "ended", label: "Ended" },
];

const FILTERS: { id: MissionCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sponsored", label: "Sponsored" },
  { id: "sf", label: "SF" },
  { id: "monthly", label: "Monthly" },
];

export default function MissionsPage() {
  const [tab, setTab] = useState<MissionTab>("ongoing");
  const [filter, setFilter] = useState<MissionCategory>("all");
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [coins, setCoins] = useState(0);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/missions");
    const data = await res.json().catch(() => ({}));
    setMissions(Array.isArray(data.missions) ? data.missions : []);
    setCoins(Number(data.coins ?? 0));
    setLinked(!!data.linked);
  }, []);

  useEffect(() => {
    load()
      .catch(() => setMissions([]))
      .finally(() => setLoading(false));
  }, [load]);

  const inTab = useMemo(() => missions.filter((m) => m.tab === tab), [missions, tab]);
  const inProgress = useMemo(
    () => inTab.filter((m) => m.progress > 0 && m.progress < m.goal && !m.claimed),
    [inTab]
  );
  const available = useMemo(() => {
    const base = tab === "ongoing" ? inTab.filter((m) => !inProgress.includes(m)) : inTab;
    if (filter === "all") return base;
    return base.filter((m) => m.category === filter);
  }, [inTab, inProgress, filter, tab]);

  const claim = async (missionId: string) => {
    setBusyId(missionId);
    setNotice(null);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error || "Could not claim.");
        return;
      }
      if (Array.isArray(data.missions)) setMissions(data.missions);
      if (typeof data.coins === "number") setCoins(data.coins);
      setNotice(`Claimed +${data.reward} HL Coins`);
    } catch {
      setNotice("Could not claim.");
    } finally {
      setBusyId(null);
      setTimeout(() => setNotice(null), 3500);
    }
  };

  return (
    <div className="hl-page">
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/5 bg-[#141414]">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,85,0,0.18), transparent 45%), radial-gradient(circle at 80% 0%, rgba(125,255,79,0.08), transparent 40%)",
          }}
        />
        <div className="relative px-5 py-7 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-white">Missions</h1>
              <p className="mt-2 max-w-xl text-sm text-[#a8a8a8]">
                Challenge yourself, earn HL Coins, and unlock cosmetics in the shop.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-hl-gold/40 bg-hl-panel px-4 py-1.5">
              <Coins className="h-4 w-4 text-hl-gold" />
              <span className="stat-number text-lg text-white">{coins.toLocaleString()}</span>
              <span className="text-xs font-semibold text-hl-muted">HL Coins</span>
            </div>
          </div>
          <div className="mt-6 flex gap-5 border-b border-white/10">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`pb-2 text-xs font-bold uppercase tracking-wide ${
                  tab === t.id
                    ? "border-b-2 border-[#ff5500] text-white"
                    : "text-[#8a8a8a] hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!linked ? (
        <p className="mb-4 text-sm text-hl-muted">
          <Link href="/login" className="font-bold text-hl-gold hover:underline">Log in</Link>{" "}
          and link a player to track progress and claim rewards.
        </p>
      ) : null}

      {notice ? (
        <div className="mb-4 rounded-lg border border-hl-green/30 bg-hl-green/10 px-3 py-2 text-xs text-hl-green">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="py-16 text-center text-sm text-hl-muted">Loading missions…</div>
      ) : (
        <>
          {tab === "ongoing" && inProgress.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-bold text-white">In progress</h2>
              <div className="space-y-3">
                {inProgress.map((m) => (
                  <ProgressCard key={m.id} mission={m} busy={busyId === m.id} onClaim={claim} />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-white">
                {tab === "ongoing" ? "Available" : tab === "upcoming" ? "Coming up" : "Past missions"}
              </h2>
              {tab === "ongoing" ? (
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={`rounded-full px-3 py-1 text-[11px] font-bold border ${
                        filter === f.id
                          ? "border-transparent bg-white text-black"
                          : "border-hl-border text-hl-muted hover:text-white"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {available.length === 0 ? (
              <div className="py-12 text-center text-sm text-hl-muted">Nothing here right now.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {available.map((m) => (
                  <MissionCard key={m.id} mission={m} busy={busyId === m.id} onClaim={claim} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ProgressCard({
  mission,
  busy,
  onClaim,
}: {
  mission: MissionView;
  busy: boolean;
  onClaim: (id: string) => void;
}) {
  const pct = Math.round((mission.progress / mission.goal) * 100);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hl-border bg-hl-panel px-4 py-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#1f1f1f]">
        <Crosshair className="h-5 w-5 text-[#ff5500]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-white">{mission.title}</div>
        <div className="text-xs text-hl-muted">{mission.description}</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-[#ff5500]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-hl-muted">
          <span>
            {mission.progress}/{mission.goal}
          </span>
          {mission.endsInLabel ? <span>{mission.endsInLabel}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1 font-bold text-hl-gold">
          <Coins className="h-3.5 w-3.5" />
          {mission.rewardCoins.toLocaleString()}
        </span>
        {mission.claimable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onClaim(mission.id)}
            className="find-match-btn h-8 rounded-lg px-3 text-xs font-black header-caps text-hl-base"
          >
            {busy ? "…" : "Claim"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MissionCard({
  mission,
  busy,
  onClaim,
}: {
  mission: MissionView;
  busy: boolean;
  onClaim: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-hl-border bg-hl-panel">
      <div
        className="relative aspect-[16/9] bg-[#1a1a1a]"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(255,85,0,0.35), rgba(20,20,20,0.95)), radial-gradient(circle at 70% 30%, rgba(125,255,79,0.15), transparent 50%)",
        }}
      >
        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-bold text-hl-gold">
          <Coins className="h-3.5 w-3.5" />
          {mission.rewardCoins >= 1000
            ? `${Math.round(mission.rewardCoins / 1000)}K`
            : mission.rewardCoins}
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <div className="text-lg font-black text-white">{mission.title}</div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#c8c8c8]">
            Organized by {mission.organizedBy}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-hl-border px-3 py-3">
        <div>
          <div className="text-sm text-white">{mission.description}</div>
          <div className="mt-1 text-[11px] text-hl-muted">
            {mission.tab === "ongoing" ? (
              <>
                <span className="font-bold text-[#7dff4f]">ACTIVE</span>
                {" · "}
                {mission.progress}/{mission.goal}
              </>
            ) : mission.tab === "upcoming" ? (
              <span className="font-bold text-[#ffc44d]">UPCOMING</span>
            ) : (
              <span className="font-bold text-hl-muted">ENDED</span>
            )}
          </div>
        </div>
        {mission.claimable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onClaim(mission.id)}
            className="find-match-btn h-8 shrink-0 rounded-lg px-3 text-xs font-black header-caps text-hl-base"
          >
            {busy ? "…" : "Claim"}
          </button>
        ) : mission.claimed ? (
          <span className="text-xs font-bold text-hl-gold">Claimed</span>
        ) : null}
      </div>
    </div>
  );
}
