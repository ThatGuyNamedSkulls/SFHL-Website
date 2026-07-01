"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { UserSession, RankTierLetter } from "@/types";
import {
  Swords,
  Trophy,
  Rss,
  Users,
  ChevronRight,
  Globe,
  Megaphone,
  ArrowUpRight,
  Zap,
} from "lucide-react";

interface DashboardProps {
  session: UserSession;
}

interface PlayerInfo {
  rank: RankTierLetter;
  elo: number;
  stats: { matchesPlayed: number; winPercent: number };
}

interface Announcement {
  id: string;
  author: string;
  avatar: string | null;
  content: string;
  timestamp: string;
  attachments: string[];
}

interface RecentMatch {
  matchId: number;
  date: string;
  map: string;
  region: string;
}

interface PartyAvatar {
  discordId: string;
  username: string;
  avatar: string | null;
}

export function Dashboard({ session }: DashboardProps) {
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [partyCount, setPartyCount] = useState(0);
  const [partyAvatars, setPartyAvatars] = useState<PartyAvatar[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [matches, setMatches] = useState<RecentMatch[]>([]);

  const displayName = session.playerName || session.username;

  useEffect(() => {
    if (session.playerName) {
      fetch(`/api/players/${encodeURIComponent(session.playerName)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setPlayer({ rank: d.rank, elo: d.elo, stats: d.stats }))
        .catch(() => { });
    }
    fetch("/api/parties")
      .then((r) => r.json())
      .then((d) => {
        setPartyCount(d.count ?? 0);
        const members = (d.parties ?? []).flatMap(
          (p: { members: PartyAvatar[] }) => p.members
        );
        setPartyAvatars(members.slice(0, 5));
      })
      .catch(() => { });
    fetch("/api/discord/announcements")
      .then((r) => r.json())
      .then((d) => setAnnouncement(d.announcements?.[0] ?? null))
      .catch(() => { });
    fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => setMatches(Array.isArray(d) ? d.slice(0, 4) : []))
      .catch(() => { });
  }, [session.playerName]);

  const gameCards = [
    { href: "/queue", title: "Matchmaking", desc: "Find a ranked 5v5 match", icon: Swords, accent: "from-hl-burnt/30" },
    { href: "/tournaments", title: "Tournaments", desc: "Compete for prizes", icon: Trophy, accent: "from-hl-gold/20" },
    { href: "/matches", title: "Recent Activity", desc: "Browse recent matches", icon: Rss, accent: "from-hl-teal/20" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Promo banner */}
      <Card className="relative overflow-hidden border-hl-border p-0 mb-6">
        <div className="absolute inset-0 bg-hero-gradient opacity-80" />
        <div className="absolute inset-0 bg-hero-radial" />
        <div className="relative z-10 px-8 py-10 md:py-12">
          <span className="inline-flex items-center gap-1.5 text-xs header-caps text-hl-gold bg-hl-base/40 border border-hl-gold/30 rounded-full px-3 py-1 mb-4">
            <Zap className="w-3 h-3" /> Season 1 is Live
          </span>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
            Welcome back, {displayName}
          </h1>
          <p className="text-hl-muted max-w-md">
            Queue up, climb the ladder, and track your rating across the season.
          </p>
        </div>
      </Card>

      {/* Game selector bar */}
      <Card className="bg-hl-panel border-hl-border p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gold-gradient flex items-center justify-center">
            <Swords className="w-5 h-5 text-hl-base" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Blox Strike</div>
            <div className="text-xs text-hl-muted flex items-center gap-1">
              <Globe className="w-3 h-3" /> EU
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] header-caps text-hl-muted">Skill Level</span>
          {player ? (
            <div className="flex items-center gap-2">
              <RankBadge rank={player.rank} size="sm" />
              <span className="stat-number text-hl-gold text-lg">{player.elo}</span>
            </div>
          ) : (
            <span className="text-sm text-hl-muted">Unranked</span>
          )}
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Center: game cards */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid sm:grid-cols-3 gap-4">
            {gameCards.map((c) => {
              const Icon = c.icon;
              return (
                <Link key={c.title} href={c.href}>
                  <Card className="relative overflow-hidden bg-hl-panel border-hl-border p-0 h-44 flex flex-col card-hover-glow group cursor-pointer">
                    {/* Art region with centered circular icon */}
                    <div className={`relative flex-1 flex items-center justify-center bg-gradient-to-b ${c.accent} to-hl-base/0`}>
                      <div className="w-16 h-16 rounded-full bg-hl-base/70 border border-hl-gold/30 flex items-center justify-center group-hover:border-hl-gold/60 transition-colors">
                        <Icon className="w-7 h-7 text-hl-gold" />
                      </div>
                    </div>
                    {/* Label region */}
                    <div className="text-center py-3 px-2 border-t border-hl-border">
                      <div className="font-bold text-white text-sm group-hover:text-hl-gold transition-colors">{c.title}</div>
                      <div className="text-[11px] text-hl-muted mt-0.5">{c.desc}</div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>

          {/* Latest post (announcements) */}
          <Card className="bg-hl-panel border-hl-border p-5">
            <h2 className="text-sm font-bold text-white header-caps mb-4 flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-hl-gold" /> Latest Post
            </h2>
            {announcement ? (
              <div className="flex gap-3">
                <Avatar className="w-10 h-10 border border-hl-border shrink-0">
                  {announcement.avatar ? <AvatarImage src={announcement.avatar} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                    {announcement.author.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{announcement.author}</span>
                    <span className="text-[10px] text-hl-muted">
                      {new Date(announcement.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-hl-muted mt-1 whitespace-pre-wrap line-clamp-4">
                    {announcement.content || "(no text)"}
                  </p>
                  {announcement.attachments[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={announcement.attachments[0]}
                      alt="attachment"
                      className="mt-3 rounded-lg max-h-48 border border-hl-border"
                    />
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-hl-muted">No announcements to show right now.</p>
            )}
          </Card>

          {/* Recent match cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white header-caps">Recent Matches</h2>
              <Link href="/matches" className="text-xs text-hl-gold hover:underline flex items-center gap-1">
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {matches.length === 0 ? (
              <Card className="bg-hl-panel border-hl-border p-6 text-center text-sm text-hl-muted">
                No matches recorded yet.
              </Card>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {matches.map((m) => (
                  <Link key={m.matchId} href={`/match/${m.matchId}`}>
                    <Card className="bg-hl-panel border-hl-border p-4 card-hover-glow group cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-white group-hover:text-hl-gold transition-colors">{m.map}</div>
                          <div className="text-xs text-hl-muted mt-0.5">{m.region} · {m.date}</div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-6">
          {/* Parties */}
          <Card className="bg-hl-panel border-hl-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-white header-caps flex items-center gap-2">
                <Users className="w-4 h-4 text-hl-gold" /> Parties
              </h2>
              <span className="text-xs text-hl-muted">{partyCount} open</span>
            </div>
            {partyAvatars.length > 0 ? (
              <div className="flex items-center gap-2 mb-4">
                <div className="flex -space-x-2">
                  {partyAvatars.map((m) => (
                    <Avatar key={m.discordId} className="w-8 h-8 border-2 border-hl-panel">
                      {m.avatar ? <AvatarImage src={m.avatar} /> : null}
                      <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                        {m.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <span className="text-xs text-hl-muted">looking for teammates</span>
              </div>
            ) : (
              <p className="text-sm text-hl-muted mb-4">Team up with other players before you queue.</p>
            )}
            <Link
              href="/party-finder"
              className="inline-flex w-full items-center justify-center gap-2 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity"
            >
              Party Finder
            </Link>
          </Card>

          {/* Clubs / Tournaments */}
          <Card className="bg-hl-panel border-hl-border p-5">
            <h2 className="text-sm font-bold text-white header-caps flex items-center gap-2 mb-4">
              <Trophy className="w-4 h-4 text-hl-gold" /> Clubs
            </h2>
            <div className="space-y-2">
              <Link href="/tournaments" className="flex items-center justify-between p-3 rounded-lg bg-hl-panel-light/40 hover:bg-hl-panel-light transition-colors group">
                <span className="text-sm text-white">Tournaments</span>
                <ChevronRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
              </Link>
              <Link href="/leaderboards" className="flex items-center justify-between p-3 rounded-lg bg-hl-panel-light/40 hover:bg-hl-panel-light transition-colors group">
                <span className="text-sm text-white">Leaderboards</span>
                <ChevronRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
              </Link>
              <Link href="/ranks" className="flex items-center justify-between p-3 rounded-lg bg-hl-panel-light/40 hover:bg-hl-panel-light transition-colors group">
                <span className="text-sm text-white">How ranks work</span>
                <ChevronRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
