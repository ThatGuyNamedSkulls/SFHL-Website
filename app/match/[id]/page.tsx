"use client";

import { use, useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { RankBadgeInline } from "@/components/rank-badge";
import { MatchDetail, MatchPlayerStats } from "@/types";
import {
  ArrowLeft,
  MapPin,
  Globe,
  Trophy,
  Star,
  Shield,
} from "lucide-react";

/** Overlapping avatar stack for a team header. */
function AvatarStack({
  players,
  align = "left",
}: {
  players: MatchPlayerStats[];
  align?: "left" | "right";
}) {
  return (
    <div
      className={`flex ${align === "right" ? "flex-row-reverse" : ""} items-center`}
    >
      {players.map((p, i) => (
        <Avatar
          key={p.playerId}
          className={`w-8 h-8 border-2 border-hl-panel ${i === 0 ? "" : "-ml-2"}`}
          style={{ zIndex: players.length - i }}
          title={p.username}
        >
          {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.username} /> : null}
          <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
            {p.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
    </div>
  );
}

export default function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/matches/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Match not found");
        return r.json();
      })
      .then((data) => {
        setMatch(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Match not found");
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-4 w-32 mb-6" />
        <Skeleton className="h-32 w-full mb-6 rounded-xl" />
        <Skeleton className="h-9 w-64 mb-4 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Match Not Found</h1>
        <p className="text-hl-muted mb-6">
          Detailed scoreboard data is not available for this match.
        </p>
        <Link
          href="/matches"
          className="inline-flex items-center gap-2 text-hl-gold hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Matches
        </Link>
      </div>
    );
  }

  const teamAPlayers = match.players
    .filter((p) => p.team === "A")
    .sort((a, b) => b.score - a.score);
  const teamBPlayers = match.players
    .filter((p) => p.team === "B")
    .sort((a, b) => b.score - a.score);

  const teamAWon = match.winner === "A";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/matches"
        className="inline-flex items-center gap-2 text-sm text-hl-muted hover:text-hl-gold transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Matches
      </Link>

      {/* ============================================================
          MATCH HEADER
          ============================================================ */}
      <Card className="bg-hl-panel border-hl-border p-6 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-radial opacity-30 pointer-events-none" />

        <div className="relative z-10">
          {/* Top meta row */}
          <div className="flex flex-wrap items-center gap-3 mb-6 text-xs text-hl-muted">
            <Badge className="bg-hl-gold/10 text-hl-gold border-hl-gold/30 text-xs">
              M-{match.id}
            </Badge>
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {match.map}
            </span>
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" />
              {match.region}
            </span>
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {match.mode}
            </span>
            <span>{match.date}</span>
          </div>

          {/* Scoreboard header */}
          <div className="flex items-center justify-center gap-6 md:gap-12">
            {/* Team A */}
            <div className="flex-1 flex flex-col items-end gap-2">
              <div
                className={`text-lg md:text-xl font-bold ${
                  teamAWon ? "text-hl-gold" : "text-white"
                }`}
              >
                {teamAWon && (
                  <Trophy className="w-4 h-4 text-hl-gold inline mr-2" />
                )}
                {match.teamAName}
              </div>
              <AvatarStack players={teamAPlayers} align="right" />
            </div>

            {/* Score (round score or team point totals) */}
            <div className="flex flex-col items-center shrink-0">
              <div className="flex items-center gap-3">
                <span
                  className={`text-4xl md:text-5xl stat-number ${
                    teamAWon ? "text-hl-green" : "text-hl-red"
                  }`}
                >
                  {match.teamAScore}
                </span>
                <span className="text-2xl text-hl-muted font-light">:</span>
                <span
                  className={`text-4xl md:text-5xl stat-number ${
                    !teamAWon ? "text-hl-green" : "text-hl-red"
                  }`}
                >
                  {match.teamBScore}
                </span>
              </div>
              <span className="text-[10px] text-hl-muted header-caps mt-1">
                {match.scoreType === "rounds" ? "Round Score" : "Team Points"}
              </span>
            </div>

            {/* Team B */}
            <div className="flex-1 flex flex-col items-start gap-2">
              <div
                className={`text-lg md:text-xl font-bold ${
                  !teamAWon ? "text-hl-gold" : "text-white"
                }`}
              >
                {match.teamBName}
                {!teamAWon && (
                  <Trophy className="w-4 h-4 text-hl-gold inline ml-2" />
                )}
              </div>
              <AvatarStack players={teamBPlayers} align="left" />
            </div>
          </div>
        </div>
      </Card>

      {/* ============================================================
          SCOREBOARDS (Tabbed by team)
          ============================================================ */}
      <Tabs defaultValue="all" className="mb-6">
        <TabsList className="bg-hl-panel border border-hl-border mb-4">
          <TabsTrigger
            value="all"
            className="text-xs data-[state=active]:bg-hl-gold data-[state=active]:text-hl-base"
          >
            All Players
          </TabsTrigger>
          <TabsTrigger
            value="teamA"
            className="text-xs data-[state=active]:bg-hl-gold data-[state=active]:text-hl-base"
          >
            {match.teamAName}
          </TabsTrigger>
          <TabsTrigger
            value="teamB"
            className="text-xs data-[state=active]:bg-hl-gold data-[state=active]:text-hl-base"
          >
            {match.teamBName}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <ScoreboardTable title={match.teamAName} players={teamAPlayers} isWinner={teamAWon} />
          <div className="h-4" />
          <ScoreboardTable title={match.teamBName} players={teamBPlayers} isWinner={!teamAWon} />
        </TabsContent>

        <TabsContent value="teamA">
          <ScoreboardTable title={match.teamAName} players={teamAPlayers} isWinner={teamAWon} />
        </TabsContent>

        <TabsContent value="teamB">
          <ScoreboardTable title={match.teamBName} players={teamBPlayers} isWinner={!teamAWon} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Scoreboard table for a single team, with a per-team totals row. */
function ScoreboardTable({
  title,
  players,
  isWinner,
}: {
  title: string;
  players: MatchPlayerStats[];
  isWinner: boolean;
}) {
  const totals = players.reduce(
    (acc, p) => {
      acc.kills += p.kills;
      acc.deaths += p.deaths;
      acc.assists += p.assists;
      acc.score += p.score;
      return acc;
    },
    { kills: 0, deaths: 0, assists: 0, score: 0 }
  );
  const teamKdr = totals.deaths > 0 ? totals.kills / totals.deaths : totals.kills;

  return (
    <Card className="bg-hl-panel border-hl-border overflow-hidden">
      {/* Team header */}
      <div
        className={`
          px-4 py-3 border-b border-hl-border flex items-center justify-between
          ${isWinner ? "bg-hl-green/5" : "bg-hl-red/5"}
        `}
      >
        <div className="flex items-center gap-2">
          {isWinner && <Trophy className="w-4 h-4 text-hl-gold" />}
          <span className="font-bold text-sm text-white">{title}</span>
        </div>
        <Badge
          className={`text-xs border-0 ${
            isWinner ? "bg-hl-green/15 text-hl-green" : "bg-hl-red/15 text-hl-red"
          }`}
        >
          {isWinner ? "WINNER" : "DEFEATED"}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-hl-border hover:bg-transparent">
              <TableHead className="text-hl-muted text-[10px] header-caps">Player</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">Rank</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">K</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">D</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">A</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">KDR</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">HS%</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">Score</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">ELO ±</TableHead>
              <TableHead className="text-hl-muted text-[10px] header-caps text-center">MVP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.map((player) => (
              <TableRow
                key={player.playerId}
                className={`border-hl-border transition-colors ${
                  player.mvp ? "bg-hl-gold/5 hover:bg-hl-gold/10" : "hover:bg-hl-panel-light/50"
                }`}
              >
                {/* Player name */}
                <TableCell className="font-medium text-sm text-white">
                  <Link
                    href={`/profile?player=${encodeURIComponent(player.username)}`}
                    className="flex items-center gap-2.5 hover:text-hl-gold transition-colors"
                  >
                    <Avatar className="w-7 h-7 border border-hl-border shrink-0">
                      {player.avatarUrl ? (
                        <AvatarImage src={player.avatarUrl} alt={player.username} />
                      ) : null}
                      <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                        {player.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{player.username}</span>
                  </Link>
                </TableCell>

                <TableCell className="text-center">
                  <RankBadgeInline rank={player.rank} />
                </TableCell>
                <TableCell className="text-center font-mono text-sm text-white">{player.kills}</TableCell>
                <TableCell className="text-center font-mono text-sm text-hl-red">{player.deaths}</TableCell>
                <TableCell className="text-center font-mono text-sm text-hl-teal">{player.assists}</TableCell>
                <TableCell
                  className={`text-center font-mono text-sm font-semibold ${
                    player.kdr >= 1.0 ? "text-hl-green" : "text-hl-red"
                  }`}
                >
                  {player.kdr.toFixed(2)}
                </TableCell>
                <TableCell className="text-center font-mono text-sm text-hl-teal">
                  {player.headshotPercent.toFixed(1)}%
                </TableCell>
                <TableCell className="text-center font-mono text-sm text-hl-gold font-semibold">
                  {player.score}
                </TableCell>
                <TableCell className="text-center font-mono text-sm">
                  <span className={player.eloChange > 0 ? "text-hl-green" : "text-hl-red"}>
                    {player.eloChange > 0 ? "+" : ""}
                    {player.eloChange}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {player.mvp && (
                    <Star
                      className="w-4 h-4 text-hl-gold mx-auto fill-hl-gold"
                      aria-label="Match MVP"
                    >
                      <title>Match MVP</title>
                    </Star>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {/* Per-team totals */}
            <TableRow className="border-hl-border bg-hl-base/40 hover:bg-hl-base/40">
              <TableCell className="text-[10px] header-caps text-hl-muted">Team Total</TableCell>
              <TableCell />
              <TableCell className="text-center font-mono text-sm font-semibold text-white">
                {totals.kills}
              </TableCell>
              <TableCell className="text-center font-mono text-sm font-semibold text-hl-red">
                {totals.deaths}
              </TableCell>
              <TableCell className="text-center font-mono text-sm font-semibold text-hl-teal">
                {totals.assists}
              </TableCell>
              <TableCell
                className={`text-center font-mono text-sm font-semibold ${
                  teamKdr >= 1.0 ? "text-hl-green" : "text-hl-red"
                }`}
              >
                {teamKdr.toFixed(2)}
              </TableCell>
              <TableCell />
              <TableCell className="text-center font-mono text-sm font-semibold text-hl-gold">
                {totals.score}
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
