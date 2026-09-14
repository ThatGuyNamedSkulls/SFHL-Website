"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { RankBadge } from "@/components/rank-badge";
import { UserSession, RankTierLetter } from "@/types";
import { TrendingUp } from "lucide-react";

interface TrackStats {
  rank: RankTierLetter;
  elo: number;
  stats: {
    wins: number;
    matchesPlayed: number;
    kd: number;
    winPercent: number;
    headshotPercent: number;
  };
}

export default function TrackPage() {
  const [session, setSession] = useState<UserSession | null | undefined>(undefined);
  const [player, setPlayer] = useState<TrackStats | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user ?? null))
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    if (!session?.playerName) return;
    fetch(`/api/players/${encodeURIComponent(session.playerName)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setPlayer({
          rank: d.rank,
          elo: d.elo,
          stats: {
            wins: d.stats?.wins ?? 0,
            matchesPlayed: d.stats?.matchesPlayed ?? 0,
            kd: d.stats?.kd ?? 0,
            winPercent: d.stats?.winPercent ?? 0,
            headshotPercent: d.stats?.headshotPercent ?? 0,
          },
        });
      })
      .catch(() => {});
  }, [session?.playerName]);

  if (session === undefined) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <div className="w-10 h-10 rounded-full border-2 border-hl-border border-t-hl-gold animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="hl-page py-16 text-center">
        <TrendingUp className="w-8 h-8 text-hl-gold mx-auto mb-3" />
        <h1 className="text-2xl font-black text-white mb-2">Track</h1>
        <p className="text-sm text-hl-muted mb-6">Log in to see your Strike Force stats.</p>
        <Link href="/login" className="inline-flex px-5 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-black text-sm header-caps">
          Log in
        </Link>
      </div>
    );
  }

  if (!session.playerName) {
    return (
      <div className="hl-page py-16 text-center">
        <h1 className="text-2xl font-black text-white mb-2">Track</h1>
        <p className="text-sm text-hl-muted">
          Your Discord account isn&apos;t linked to a HyperLeague player yet. Ask an admin to add you.
        </p>
      </div>
    );
  }

  const s = player?.stats;
  const tiles = [
    { label: "Elo", value: player ? String(player.elo) : "—" },
    { label: "Win %", value: s ? `${s.winPercent.toFixed(0)}%` : "—" },
    { label: "K/D", value: s ? s.kd.toFixed(2) : "—" },
    { label: "HS %", value: s ? `${s.headshotPercent.toFixed(0)}%` : "—" },
    { label: "Matches", value: s ? String(s.matchesPlayed) : "—" },
    { label: "Wins", value: s ? String(s.wins) : "—" },
  ];

  return (
    <div className="hl-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs header-caps text-hl-gold mb-1">Strike Force</div>
          <h1 className="text-2xl font-black text-white">Track</h1>
          <p className="text-sm text-hl-muted mt-1">Your recorded matchmaking stats.</p>
        </div>
        {player && <RankBadge rank={player.rank} size="lg" />}
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="bg-hl-panel border-hl-border p-4">
            <div className="text-[11px] header-caps text-hl-muted">{t.label}</div>
            <div className="stat-number text-2xl text-white mt-1">{t.value}</div>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Link href={`/profile?player=${encodeURIComponent(session.playerName)}`} className="text-sm text-hl-gold hover:underline">
          Open full profile
        </Link>
      </div>
    </div>
  );
}
