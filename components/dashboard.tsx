"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GameSkillBar } from "@/components/game-skill-bar";
import { RankTierLetter, UserSession } from "@/types";
import {
  Swords,
  Trophy,
  ChevronRight,
  Globe,
  Megaphone,
  ArrowUpRight,
  Zap,
  UserPlus,
} from "lucide-react";
import { apiGetJson } from "@/lib/client-api";

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

interface LiveLobbyHint {
  channelName: string;
  voiceChannelUrl: string | null;
}

interface PartyAvatar {
  discordId: string;
  username: string;
  avatar: string | null;
}

/** FACEIT-home inspired dashboard for HyperLeague / Strike Force. */
export function Dashboard({ session }: DashboardProps) {
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [partyCount, setPartyCount] = useState(0);
  const [partyAvatars, setPartyAvatars] = useState<PartyAvatar[]>([]);
  const [partyLooking, setPartyLooking] = useState(0);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [matches, setMatches] = useState<RecentMatch[]>([]);
  const [liveLobby, setLiveLobby] = useState<LiveLobbyHint | null>(null);

  const displayName = session.playerName || session.username;

  useEffect(() => {
    if (session.playerName) {
      fetch(`/api/players/${encodeURIComponent(session.playerName)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setPlayer({ rank: d.rank, elo: d.elo, stats: d.stats }))
        .catch(() => {});
    }
    apiGetJson<{
      count?: number;
      parties?: { members: PartyAvatar[] }[];
    }>("/api/parties")
      .then(({ json: d }) => {
        setPartyCount(d.count ?? 0);
        const parties = d.parties ?? [];
        const members = parties.flatMap(
          (p) => p.members
        );
        setPartyAvatars(members.slice(0, 5));
        setPartyLooking(members.length);
      })
      .catch(() => {});
    apiGetJson<{ announcements?: Announcement[] }>("/api/discord/announcements")
      .then(({ json: d }) => setAnnouncement(d.announcements?.[0] ?? null))
      .catch(() => {});
    apiGetJson<RecentMatch[]>("/api/matches")
      .then(({ json: d }) => setMatches(Array.isArray(d) ? d.slice(0, 4) : []))
      .catch(() => {});
    apiGetJson<{ lobby?: { channelName: string; voiceChannelUrl?: string | null } | null }>("/api/lobby")
      .then(({ json: d }) => {
        const lobby = d?.lobby;
        setLiveLobby(
          lobby
            ? { channelName: lobby.channelName, voiceChannelUrl: lobby.voiceChannelUrl ?? null }
            : null
        );
      })
      .catch(() => {});
  }, [session.playerName]);

  const modeCards = [
    {
      href: "/queue",
      title: "Matchmaking",
      desc: "Ranked 5v5 Strike Force",
      icon: Swords,
      glow: "from-hl-gold/35",
      soon: false,
    },
    {
      href: "#",
      title: "League",
      desc: "Coming soon",
      icon: Trophy,
      glow: "from-orange-500/25",
      soon: true,
    },
    {
      href: "#",
      title: "Tournaments",
      desc: "Coming soon",
      icon: Globe,
      glow: "from-hl-teal/25",
      soon: true,
    },
  ];

  return (
    <div className="hl-page-wide">
      {liveLobby && (
        <Card className="mb-5 border-hl-gold/50 bg-hl-panel p-4 flex flex-wrap items-center gap-3">
          <Swords className="w-5 h-5 text-hl-gold shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-white">Match found — #{liveLobby.channelName}</div>
            <div className="text-xs text-hl-muted">Open the match room for veto, teams, and Discord voice.</div>
          </div>
          <Link
            href="/match/live"
            className="inline-flex px-4 py-2 rounded-lg bg-gold-gradient text-hl-base font-black text-xs header-caps hover:opacity-90"
          >
            Open match room
          </Link>
        </Card>
      )}
      {/* Promo banner — FACEIT-style hero */}
      <Card className="relative overflow-hidden border-hl-border p-0 mb-5">
        <div className="absolute inset-0 bg-hero-gradient opacity-90" />
        <div className="absolute inset-0 bg-hero-radial" />
        <div className="relative z-10 px-6 sm:px-8 py-8 md:py-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] header-caps text-hl-gold bg-hl-base/50 border border-hl-gold/30 rounded-full px-3 py-1 mb-3">
              <Zap className="w-3 h-3" /> Season 1 · Strike Force
            </span>
            <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight mb-2">
              Compete in <span className="text-hl-gold">HyperLeague</span> Matchmaking
            </h1>
            <div className="flex flex-wrap gap-2 mb-3">
              {["5v5 only", "Discord synced", "Verified matching", "Map veto"].map((t) => (
                <span
                  key={t}
                  className="text-[11px] text-hl-muted bg-hl-base/50 border border-hl-border rounded-full px-2.5 py-1"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="text-sm text-hl-muted max-w-lg">
              Welcome back, {displayName}. Queue from the website or Discord — same lobby, same match room.
            </p>
          </div>
          <Link
            href="/queue"
            className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-[#ccff00] text-hl-base font-black text-sm header-caps hover:opacity-90 transition-opacity shadow-[0_0_24px_rgba(204,255,0,0.25)]"
          >
            Find Match
          </Link>
        </div>
      </Card>

      <GameSkillBar rank={player?.rank} elo={player?.elo} className="mb-5" />

      <div className="grid lg:grid-cols-[1fr_300px] gap-5">
        {/* Left: mode cards stacked like FACEIT */}
        <div className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-3">
            {modeCards.map((c) => {
              const Icon = c.icon;
              const inner = (
                  <Card className={`relative overflow-hidden bg-hl-panel border-hl-border p-0 h-48 flex flex-col ${c.soon ? "opacity-70" : "card-hover-glow group cursor-pointer"}`}>
                    <div
                      className={`relative flex-1 flex items-center justify-center bg-gradient-to-t ${c.glow} via-transparent to-transparent`}
                    >
                      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-hl-gold/20 to-transparent opacity-80 group-hover:opacity-100 transition-opacity" />
                      <div className="relative w-16 h-16 rounded-full bg-hl-base/80 border border-hl-gold/30 flex items-center justify-center group-hover:border-hl-gold/70 group-hover:shadow-[0_0_24px_rgba(255,85,0,0.35)] transition-all">
                        <Icon className="w-7 h-7 text-hl-gold" />
                      </div>
                    </div>
                    <div className="text-center py-3 px-2 border-t border-hl-border bg-hl-panel">
                      <div className="font-black text-white text-sm group-hover:text-hl-gold transition-colors">
                        {c.title}
                      </div>
                      <div className="text-[11px] text-hl-muted mt-0.5">{c.desc}</div>
                    </div>
                  </Card>
              );
              if (c.soon) {
                return (
                  <div key={c.title} className="block h-full" title="Coming soon">
                    {inner}
                  </div>
                );
              }
              return (
                <Link key={c.title} href={c.href} className="block h-full">
                  {inner}
                </Link>
              );
            })}
          </div>

          {/* Latest post */}
          <Card className="bg-hl-panel border-hl-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white header-caps flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-hl-gold" /> Latest Post
            </h2>
            <Link href="/feed" className="text-xs text-hl-gold hover:underline">
              Feed
            </Link>
          </div>
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

          {/* Recent matches */}
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
                          <div className="font-bold text-white group-hover:text-hl-gold transition-colors">
                            {m.map}
                          </div>
                          <div className="text-xs text-hl-muted mt-0.5">
                            {m.region} · {m.date}
                          </div>
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

        {/* Right rail — Parties / Friends (FACEIT-style) */}
        <div className="space-y-4">
          <Card className="bg-hl-panel border-hl-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black text-white header-caps flex items-center gap-2">
                Parties
                <span className="text-[10px] font-bold text-hl-muted bg-hl-base border border-hl-border rounded px-1.5 py-0.5">
                  {partyCount}
                </span>
              </h2>
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
                <span className="text-xs text-hl-muted">+{Math.max(0, partyLooking - partyAvatars.length)}</span>
              </div>
            ) : (
              <p className="text-sm text-hl-muted mb-4">No open parties yet — start one and queue together.</p>
            )}
            <Link
              href="/party-finder"
              className="inline-flex w-full items-center justify-center gap-2 py-2.5 rounded-md bg-hl-panel-light border border-hl-border text-white font-black text-xs header-caps hover:border-hl-gold/50 hover:text-hl-gold transition-colors"
            >
              Party Finder
            </Link>
          </Card>

          <Card className="bg-hl-panel border-hl-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black text-white header-caps flex items-center gap-2">
                Friends
              </h2>
              <UserPlus className="w-4 h-4 text-hl-muted" />
            </div>
            <p className="text-sm text-hl-muted mb-4">
              Add friends, invite to party, and queue together across Discord + web.
            </p>
            <Link
              href="/friends"
              className="inline-flex w-full items-center justify-center gap-2 py-2.5 rounded-md bg-hl-panel-light border border-hl-border text-white font-black text-xs header-caps hover:border-hl-gold/50 hover:text-hl-gold transition-colors"
            >
              Open Friends
            </Link>
          </Card>

          <Card className="bg-hl-panel border-hl-border p-4">
            <h2 className="text-sm font-black text-white header-caps flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-hl-gold" /> Clubs
              <span className="text-[10px] font-bold text-hl-muted bg-hl-base border border-hl-border rounded px-1.5 py-0.5">
                Soon
              </span>
            </h2>
            <p className="text-xs text-hl-muted mb-3">
              Community clubs with their own queues and leaderboards are planned — not available yet.
            </p>
            <div className="space-y-1.5">
              <Link
                href="/leaderboards"
                className="flex items-center justify-between p-2.5 rounded-md bg-hl-panel-light/40 hover:bg-hl-panel-light transition-colors group"
              >
                <span className="text-sm text-white">Season leaderboards</span>
                <ChevronRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
              </Link>
              <Link
                href="/ranks"
                className="flex items-center justify-between p-2.5 rounded-md bg-hl-panel-light/40 hover:bg-hl-panel-light transition-colors group"
              >
                <span className="text-sm text-white">How ranks work</span>
                <ChevronRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
              </Link>
              <Link
                href="/shop"
                className="flex items-center justify-between p-2.5 rounded-md bg-hl-panel-light/40 hover:bg-hl-panel-light transition-colors group"
              >
                <span className="text-sm text-white">Shop / cosmetics</span>
                <ChevronRight className="w-4 h-4 text-hl-muted group-hover:text-hl-gold" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
