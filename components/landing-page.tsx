"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadgeInline } from "@/components/rank-badge";
import {
  Gamepad2,
  Trophy,
  Users,
  Zap,
  ChevronRight,
  ArrowUpRight,
  Crosshair,
  Target,
  MapPin,
  Swords,
} from "lucide-react";

interface ApiPlayer {
  id: string;
  username: string;
  avatarUrl: string;
  rank: string;
  elo: number;
  peakElo: number;
  stats: { kd: number; winPercent: number; matchesPlayed: number };
}

interface ApiStats {
  activePlayers: number;
  totalMatches: number;
  totalKills: number;
}

interface ApiMatch {
  matchId: number;
  date: string;
  map: string;
  region: string;
}

/** Marketing / landing page shown to logged-out visitors. */
export function LandingPage() {
  const [topPlayers, setTopPlayers] = useState<ApiPlayer[]>([]);
  const [recentMatches, setRecentMatches] = useState<ApiMatch[]>([]);
  const [stats, setStats] = useState<ApiStats>({ activePlayers: 0, totalMatches: 0, totalKills: 0 });

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((data) => setTopPlayers(data.slice(0, 6)))
      .catch(console.error);
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(console.error);
    fetch("/api/matches")
      .then((r) => r.json())
      .then((data) => setRecentMatches(Array.isArray(data) ? data.slice(0, 6) : []))
      .catch(console.error);
  }, []);

  const highestElo = topPlayers[0]?.elo ?? 0;

  return (
    <div className="min-h-screen">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-gradient opacity-45" />
        <div className="absolute inset-0 bg-hero-radial" />
        {/* Fade the hero into the dark base so it isn't a solid orange block. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-hl-base to-transparent" />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(circle at 70% 30%, rgba(255,85,0,0.08) 0%, transparent 50%)" }}
        />
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
          <div className="max-w-3xl">
            <Badge className="mb-6 bg-hl-gold/10 text-hl-gold border-hl-gold/30 px-3 py-1 text-xs header-caps">
              <Zap className="w-3 h-3 mr-1.5" />
              Season 1 — Now Live
            </Badge>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black leading-[1.05] tracking-tight mb-6">
              <span className="text-white">Compete.</span>
              <br />
              <span className="text-gradient-hero">Dominate.</span>
              <br />
              <span className="text-white">Rise.</span>
            </h1>
            <p className="text-lg md:text-xl text-hl-muted max-w-xl mb-8 leading-relaxed">
              The competitive Counter-Strike league. Ranked matchmaking, ELO tracking, leaderboards, and full match
              history — synced live with the HyperLeague Discord.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/queue"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity animate-pulse-glow"
              >
                <Gamepad2 className="w-5 h-5" />
                Find Match
              </Link>
              <Link
                href="/leaderboards"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-hl-border bg-hl-panel/60 text-white font-medium text-sm hover:bg-hl-panel hover:border-hl-gold/30 transition-all"
              >
                <Trophy className="w-5 h-5 text-hl-gold" />
                View Leaderboards
              </Link>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Active Players", value: stats.activePlayers.toString(), icon: Users },
              { label: "Matches Played", value: stats.totalMatches.toString(), icon: Crosshair },
              { label: "Highest ELO", value: highestElo ? highestElo.toLocaleString() : "—", icon: Trophy },
              { label: "Total Kills", value: stats.totalKills.toLocaleString(), icon: Target },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-3 bg-hl-base/40 backdrop-blur-sm border border-hl-border/50 rounded-xl px-4 py-3"
              >
                <Icon className="w-5 h-5 text-hl-gold" />
                <div>
                  <div className="stat-number text-lg text-white">{value}</div>
                  <div className="text-xs text-hl-muted">{label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RECENT MATCHES */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white header-caps">Recent Matches</h2>
            <p className="text-sm text-hl-muted mt-1">The latest games played across HyperLeague</p>
          </div>
        </div>
        {recentMatches.length === 0 ? (
          <Card className="bg-hl-panel border-hl-border p-8 text-center text-hl-muted text-sm">
            No matches recorded yet.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentMatches.map((match) => (
              <Link href={`/match/${match.matchId}`} key={match.matchId}>
                <Card className="bg-hl-panel border-hl-border p-5 card-hover-glow group cursor-pointer">
                  <div className="flex items-center justify-between mb-3">
                    <Badge className="bg-hl-gold/10 text-hl-gold border-hl-gold/30 text-xs">
                      <Swords className="w-3 h-3 mr-1" /> Match
                    </Badge>
                    <span className="text-xs text-hl-muted">{match.date}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2 group-hover:text-hl-gold transition-colors flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-hl-muted" />
                    {match.map}
                  </h3>
                  <div className="flex items-center justify-between text-sm text-hl-muted">
                    <span>{match.region}</span>
                    <span className="flex items-center gap-1 text-hl-gold group-hover:underline">
                      View scoreboard <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* TOP PLAYERS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white header-caps">Top Players</h2>
            <p className="text-sm text-hl-muted mt-1">Highest rated players this season</p>
          </div>
          <Link href="/leaderboards" className="flex items-center gap-1 text-sm text-hl-gold hover:underline">
            Full Rankings <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {topPlayers.map((player, idx) => (
            <Link href={`/profile?player=${encodeURIComponent(player.username)}`} key={player.id}>
              <Card className="bg-hl-panel border-hl-border p-4 card-hover-glow group cursor-pointer">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                      idx === 0
                        ? "bg-gold-gradient text-hl-base"
                        : idx === 1
                        ? "bg-hl-muted/20 text-hl-muted"
                        : idx === 2
                        ? "bg-hl-burnt/20 text-hl-burnt"
                        : "bg-hl-panel-light text-hl-muted"
                    }`}
                  >
                    #{idx + 1}
                  </div>
                  <Avatar className="w-10 h-10 border border-hl-border">
                    {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
                    <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                      {player.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white truncate group-hover:text-hl-gold transition-colors">
                        {player.username}
                      </span>
                      <RankBadgeInline rank={player.rank as never} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-hl-muted mt-0.5">
                      <span>ELO <span className="text-hl-gold font-semibold">{player.elo}</span></span>
                      <span>K/D <span className="text-hl-teal font-semibold">{player.stats.kd.toFixed(2)}</span></span>
                      <span>Win <span className="text-hl-green font-semibold">{player.stats.winPercent.toFixed(0)}%</span></span>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold transition-colors" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Card className="relative overflow-hidden bg-hl-panel border-hl-border p-8 md:p-12">
          <div className="absolute inset-0 bg-hero-gradient opacity-40" />
          <div className="relative z-10 text-center max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
              Ready to <span className="text-gradient-gold">compete</span>?
            </h2>
            <p className="text-hl-muted mb-8">
              Sign in with Discord, join the queue, and climb the HyperLeague leaderboards.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gold-gradient text-hl-base font-bold hover:opacity-90 transition-opacity"
              >
                Sign in with Discord
              </Link>
              <Link
                href="/queue"
                className="inline-flex items-center gap-2 px-8 py-3 rounded-xl border border-hl-border bg-hl-panel/60 text-white font-medium hover:bg-hl-panel hover:border-hl-gold/30 transition-all"
              >
                Start Playing
              </Link>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
