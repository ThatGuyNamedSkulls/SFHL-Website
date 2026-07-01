"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { RankBadge } from "@/components/rank-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { RankTierLetter } from "@/types";
import { Trophy, Search, Users, Globe } from "lucide-react";

interface ApiPlayer {
  id: string;
  username: string;
  avatarUrl: string;
  rank: string;
  elo: number;
  peakElo: number;
  position: number;
  region: string;
  regionFlag: string;
  country: string | null;
  countryName: string | null;
  countryFlag: string | null;
  stats: { wins: number; kd: number; winPercent: number; headshotPercent: number; matchesPlayed: number };
}

export default function LeaderboardsPage() {
  const [players, setPlayers] = useState<ApiPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [myPlayer, setMyPlayer] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState("All");

  useEffect(() => {
    setLoading(true);
    fetch("/api/players")
      .then((r) => r.json())
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch leaderboards:", err);
        setLoading(false);
      });

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setMyPlayer(data.user.playerName || data.user.username);
      })
      .catch(() => {});
  }, []);

  const countryFilterOptions = useMemo(
    () =>
      Array.from(new Set(players.map((p) => p.countryName).filter((n): n is string => !!n))).sort(),
    [players]
  );

  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (countryFilter !== "All" && p.countryName !== countryFilter) return false;
      if (q && !p.username.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [players, query, countryFilter]);

  const me = useMemo(
    () => (myPlayer ? players.find((p) => p.username === myPlayer) : undefined),
    [players, myPlayer]
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader icon={Trophy} title="Rankings" subtitle="Global player rankings — Season 1" />

      {/* Your rankings bar */}
      {me && (
        <Card className="bg-hl-panel border-hl-border p-4 mb-6 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 border border-hl-border">
              {me.avatarUrl ? <AvatarImage src={me.avatarUrl} /> : null}
              <AvatarFallback className="bg-hl-panel-light text-hl-gold font-bold">
                {me.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                {me.username}
                {me.countryFlag && <Flag src={me.countryFlag} name={me.countryName} className="w-5 h-3.5" />}
              </div>
              <div className="text-xs text-hl-muted">Your rankings</div>
            </div>
          </div>
          <div className="flex items-center gap-8 ml-auto">
            <div className="text-center">
              <div className="text-[10px] text-hl-muted header-caps">Region Rank</div>
              <div className="stat-number text-xl text-white">#{me.position}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-hl-muted header-caps">Skill</div>
              <div className="flex justify-center mt-1"><RankBadge rank={me.rank as RankTierLetter} size="sm" /></div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-hl-muted header-caps">ELO</div>
              <div className="stat-number text-xl text-hl-gold">{me.elo}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select className="bg-hl-panel border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50">
          <option>Season 1 (current)</option>
        </select>
        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="bg-hl-panel border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50"
        >
          <option value="All">All countries</option>
          {countryFilterOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hl-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players…"
            className="w-full bg-hl-panel border border-hl-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50 transition-colors"
          />
        </div>
        <span className="text-xs text-hl-muted ml-auto">
          {filteredPlayers.length} player{filteredPlayers.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Leaderboard table */}
      <Card className="bg-hl-panel border-hl-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-hl-border hover:bg-transparent">
                <TableHead className="text-hl-muted text-xs header-caps w-16">Rank</TableHead>
                <TableHead className="text-hl-muted text-xs header-caps">Player</TableHead>
                <TableHead className="text-hl-muted text-xs header-caps">Country</TableHead>
                <TableHead className="text-hl-muted text-xs header-caps">Skill Level</TableHead>
                <TableHead className="text-hl-muted text-xs header-caps text-right">ELO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="lb-row border-hl-border hover:bg-transparent">
                    <TableCell><Skeleton className="w-8 h-8 rounded-lg" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-12 h-12 rounded-lg" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredPlayers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState icon={Users} title="No players found" hint="No players match your search. Try a different name." />
                  </TableCell>
                </TableRow>
              ) : (
                filteredPlayers.map((player) => {
                  const isMe = myPlayer !== null && player.username === myPlayer;
                  return (
                    <TableRow
                      key={player.id}
                      className={`lb-row border-hl-border transition-colors ${
                        isMe ? "bg-hl-gold/10 hover:bg-hl-gold/15" : "hover:bg-hl-panel-light/50"
                      }`}
                    >
                      {/* Rank number */}
                      <TableCell>
                        <span
                          className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-bold ${
                            player.position === 1
                              ? "bg-gold-gradient text-hl-base"
                              : player.position === 2
                              ? "bg-hl-muted/20 text-hl-muted"
                              : player.position === 3
                              ? "bg-hl-burnt/20 text-hl-burnt"
                              : "text-hl-muted"
                          }`}
                        >
                          {player.position}
                        </span>
                      </TableCell>

                      {/* Player (large square avatar + name) */}
                      <TableCell>
                        <Link href={`/profile?player=${encodeURIComponent(player.username)}`} className="flex items-center gap-3 group">
                          <Avatar className="w-12 h-12 rounded-lg border border-hl-border">
                            {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} className="rounded-lg" /> : null}
                            <AvatarFallback className="bg-hl-panel-light text-sm font-bold text-hl-gold rounded-lg">
                              {player.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="font-semibold text-white text-base group-hover:text-hl-gold transition-colors flex items-center gap-2">
                            {player.username}
                            {isMe && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-hl-gold/20 text-hl-gold">YOU</span>
                            )}
                          </div>
                        </Link>
                      </TableCell>

                      {/* Country (self-reported); falls back to server region */}
                      <TableCell>
                        <span className="flex items-center gap-2 text-sm text-hl-muted">
                          {player.countryFlag ? (
                            <Flag src={player.countryFlag} name={player.countryName} className="w-6 h-4" />
                          ) : (
                            <Globe className="w-4 h-4 shrink-0" />
                          )}
                          {player.countryName || player.region || "Unknown"}
                        </span>
                      </TableCell>

                      {/* Skill level badge */}
                      <TableCell>
                        <RankBadge rank={player.rank as RankTierLetter} size="sm" />
                      </TableCell>

                      {/* ELO */}
                      <TableCell className="text-right">
                        <span className="stat-number text-lg text-hl-gold">{player.elo}</span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
