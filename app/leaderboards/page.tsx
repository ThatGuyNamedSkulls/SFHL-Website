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
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { RankTierLetter } from "@/types";
import { Search, Users, Globe, Swords } from "lucide-react";
import { formatUsername } from "@/lib/format";

interface ApiPlayer {
  id: string;
  username: string;
  discordUsername?: string | null;
  avatarUrl: string;
  cardAsset: string | null;
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

/** FACEIT-style top-10 position pill: gold #1, silver #2, bronze #3, red 4–10. */
function SkillPill({ position, rank }: { position: number; rank: RankTierLetter }) {
  const cls =
    position === 1
      ? "bg-[#f5c518] text-black"
      : position === 2
        ? "bg-gray-200 text-black"
        : position === 3
          ? "bg-[#e67e22] text-black"
          : "bg-[#b02a2a] text-white";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-0.5 ${cls}`}>
      <span className="text-xs font-black stat-number">#{position}</span>
      <RankBadge rank={rank} size="sm" showGlow={false} className="!w-5 !h-5" />
    </span>
  );
}

export default function LeaderboardsPage() {
  const [players, setPlayers] = useState<ApiPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [myPlayer, setMyPlayer] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState("All");
  // Ladder tab: the main (5v5) ladder or an own-ladder gamemode (1v1).
  const [ladder, setLadder] = useState<"5v5" | "1v1">("5v5");

  useEffect(() => {
    setLoading(true);
    fetch(ladder === "5v5" ? "/api/players" : `/api/players?mode=${ladder}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // The API returns a bare array; on error (e.g. 500) it returns an
        // { error } object. Guard so a failed fetch can't crash the table
        // rendering (players.map / filter) with a non-array.
        setPlayers(Array.isArray(data) ? data : []);
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
  }, [ladder]);

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

  // Position within my own country, derived from the elo-sorted list.
  const myCountryRank = useMemo(() => {
    if (!me?.country) return null;
    return players.filter((p) => p.country === me.country && p.position < me.position).length + 1;
  }, [players, me]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top bar: game chip + centered MATCHMAKING tab (FACEIT-style) */}
      <div className="grid grid-cols-3 items-end border-b border-hl-border mb-6">
        <div className="flex items-center gap-2 pb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-hl-panel-light border border-hl-border px-2.5 py-1 text-xs font-bold text-white">
            <Swords className="w-3.5 h-3.5 text-hl-gold" /> Blox Strike
          </span>
          <span className="text-xs text-hl-muted font-bold">EU</span>
        </div>
        <div className="flex justify-center gap-6">
          {(["5v5", "1v1"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setLadder(tab)}
              className={
                ladder === tab
                  ? "inline-block pb-3 border-b-2 border-hl-gold text-sm font-bold text-hl-gold header-caps"
                  : "inline-block pb-3 border-b-2 border-transparent text-sm font-bold text-hl-muted hover:text-white header-caps"
              }
            >
              {tab === "5v5" ? "Matchmaking" : "1v1 Ladder"}
            </button>
          ))}
        </div>
        <div />
      </div>

      {/* Your rankings strip */}
      {me && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 text-sm">
          <span className="font-bold text-white">Your rankings</span>
          {me.countryFlag && (
            <span className="flex items-center gap-1.5 text-hl-muted">
              <span className="font-bold text-white">{me.country?.toUpperCase()}</span>
              <Flag src={me.countryFlag} name={me.countryName} className="w-5 h-3.5" />
              <b className="text-white stat-number">{myCountryRank ?? "—"}</b>
            </span>
          )}
          <span className="flex items-center gap-1.5 text-hl-muted">
            <span className="font-bold text-white">EU</span>
            <Globe className="w-4 h-4 text-hl-gold" />
            <b className="text-white stat-number">{me.position}</b>
          </span>
          <span className="flex items-center gap-1.5 text-hl-muted">
            Skill &amp; Elo
            <RankBadge rank={me.rank as RankTierLetter} size="sm" showGlow={false} className="!w-5 !h-5" />
            <b className="text-white stat-number">{me.elo}</b>
          </span>
        </div>
      )}

      {/* Heading + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-sm font-bold text-white">EU Rankings</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3">
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
          <select className="bg-hl-panel border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50">
            <option>EU</option>
          </select>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hl-muted pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players…"
              className="w-full bg-hl-panel border border-hl-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50 transition-colors"
            />
          </div>
        </div>
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
                <TableHead className="text-hl-muted text-xs header-caps">Skill level</TableHead>
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
                    <TableCell><Skeleton className="h-8 w-16 rounded-full" /></TableCell>
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
                  const topThree = player.position <= 3;
                  return (
                    <TableRow
                      key={player.id}
                      className={`lb-row border-hl-border transition-colors ${
                        isMe ? "bg-hl-gold/10 hover:bg-hl-gold/15" : "hover:bg-hl-panel-light/50"
                      }`}
                    >
                      {/* Rank number */}
                      <TableCell>
                        <span className="inline-flex items-center justify-center w-9 h-9 text-sm font-bold text-white stat-number">
                          {player.position}
                        </span>
                      </TableCell>

                      {/* Player — top 3 show their profile card as a portrait thumb */}
                      <TableCell>
                        <Link href={`/profile?player=${encodeURIComponent(player.username)}`} className="flex items-center gap-3 group py-1">
                          {topThree && player.cardAsset ? (
                            <span className="relative w-12 h-16 rounded-md overflow-hidden border border-hl-border shrink-0 block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={player.cardAsset} alt="" className="absolute inset-0 w-full h-full object-cover" />
                              <span className="absolute inset-0 flex items-center justify-center">
                                <Avatar className="w-9 h-9 border-2 border-hl-base/70">
                                  {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
                                  <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                                    {player.username.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              </span>
                            </span>
                          ) : (
                            <Avatar className="w-11 h-11 border border-hl-border">
                              {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
                              <AvatarFallback className="bg-hl-panel-light text-sm font-bold text-hl-gold">
                                {player.username.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className="font-semibold text-white text-base group-hover:text-hl-gold transition-colors flex items-center gap-2">
                            {formatUsername(player.username, player.discordUsername)}
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
                        </span>
                      </TableCell>

                      {/* Skill level: numbered pill for the top 10, badge beyond */}
                      <TableCell>
                        {player.position <= 10 ? (
                          <SkillPill position={player.position} rank={player.rank as RankTierLetter} />
                        ) : (
                          <RankBadge rank={player.rank as RankTierLetter} size="sm" showGlow={false} />
                        )}
                      </TableCell>

                      {/* ELO */}
                      <TableCell className="text-right">
                        <span className="stat-number text-base text-white font-bold">{player.elo.toLocaleString()}</span>
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
