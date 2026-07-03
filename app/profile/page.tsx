"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { PerformanceCard } from "@/components/performance-card";
import { ConsistencyDonut } from "@/components/consistency-donut";
import { EloGraphFaceit } from "@/components/elo-graph-faceit";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { MapStatsTable } from "@/components/map-stats-table";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import {
  StatsFilters,
  DEFAULT_FILTERS,
  applyMatchFilters,
  MatchFilters,
} from "@/components/stats-filters";
import { RANK_TIERS } from "@/data/ranks";
import { Player, Match, RankTierLetter, ProfileCosmetics } from "@/types";
import {
  Settings,
  MoreHorizontal,
  UserPlus,
  MapPin,
  Users,
  ArrowUp,
  ArrowDown,
  ListChecks,
  ArrowUpRight,
  Award,
} from "lucide-react";

type SubTab = "summary" | "matches" | "stats";

interface ProfilePlayer extends Player {
  playedWith?: { name: string; count: number }[];
  matchHistory?: Match[];
  regionFlag?: string;
  country?: string | null;
  countryName?: string | null;
  countryFlag?: string | null;
  cosmetics?: ProfileCosmetics;
}

/** Equipped badge icon with a lucide fallback when the asset is missing. */
function ProfileBadgeIcon({
  badge,
}: {
  badge: { slug: string; name: string; description: string; asset: string | null };
}) {
  const [broken, setBroken] = useState(false);
  const tooltip = badge.description ? `${badge.name} — ${badge.description}` : badge.name;
  if (badge.asset && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={badge.asset}
        alt={badge.name}
        title={tooltip}
        className="w-7 h-7 object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      title={tooltip}
      className="w-7 h-7 rounded-full bg-hl-gold/10 border border-hl-gold/30 flex items-center justify-center"
    >
      <Award className="w-4 h-4 text-hl-gold" />
    </span>
  );
}

interface LbPlayer {
  username: string;
  stats: { kd: number; winPercent: number; headshotPercent: number; scorePerGame: number };
}

const ICON_TIERS: RankTierLetter[] = ["D", "C", "B", "A1", "A2", "A3", "S1", "S2", "S3"];

/** percentile (0–100) of `value` within `all`. */
function percentile(value: number, all: number[]): number {
  if (all.length === 0) return 50;
  const below = all.filter((v) => v < value).length;
  return Math.round((below / all.length) * 100);
}

function ProfileSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid lg:grid-cols-[300px_1fr] gap-6">
      <Skeleton className="h-[520px] rounded-xl" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

function ProfileContent() {
  const searchParams = useSearchParams();
  const playerNameParam = searchParams.get("player");

  const [player, setPlayer] = useState<ProfilePlayer | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [allPlayers, setAllPlayers] = useState<LbPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>("summary");
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS);
  const [myName, setMyName] = useState<string | null>(null);
  const [friendState, setFriendState] = useState<"none" | "pending" | "friends">("none");
  const [friendMsg, setFriendMsg] = useState<string | null>(null);

  // Who am I, and is the profile I'm viewing already a friend / pending?
  useEffect(() => {
    const run = async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        const me = (await meRes.json())?.user;
        const name = me?.playerName ?? null;
        setMyName(name);
        if (!name || !playerNameParam || playerNameParam === name) return;
        const fRes = await fetch("/api/friends");
        if (!fRes.ok) return;
        const data = await fRes.json();
        if ((data.friends ?? []).some((f: { name: string }) => f.name === playerNameParam)) {
          setFriendState("friends");
        } else if ((data.outgoing ?? []).some((r: { name: string }) => r.name === playerNameParam)) {
          setFriendState("pending");
        } else {
          setFriendState("none");
        }
      } catch {
        /* ignore */
      }
    };
    run();
  }, [playerNameParam]);

  const addFriend = async () => {
    if (!player) return;
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName: player.username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFriendMsg(data.error || "Failed to add friend");
      } else if (data.status === "friends") {
        setFriendState("friends");
        setFriendMsg("You're now friends!");
      } else if (data.status === "exists") {
        setFriendState("pending");
        setFriendMsg("Request already sent.");
      } else {
        setFriendState("pending");
        setFriendMsg("Friend request sent.");
      }
    } catch {
      setFriendMsg("Failed to add friend");
    }
    setTimeout(() => setFriendMsg(null), 4000);
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      setFilters(DEFAULT_FILTERS);
      setTab("summary");
      try {
        let target = playerNameParam;
        if (!target) {
          // No ?player= → show the logged-in user's own tracker, not the #1 player.
          const meRes = await fetch("/api/auth/me");
          const me = await meRes.json();
          if (me?.user?.playerName) {
            target = me.user.playerName;
          } else if (me?.user) {
            // Logged in but Discord account isn't linked to an SFHL player yet.
            setError("Your Discord account isn't linked to an SFHL player yet. Ask an admin to add you.");
            setLoading(false);
            return;
          } else {
            // Not logged in — fall back to the top player so the page still shows something.
            const topRes = await fetch("/api/players?limit=1");
            const top = await topRes.json();
            if (Array.isArray(top) && top.length > 0) target = top[0].username;
            else {
              setError("No players found");
              setLoading(false);
              return;
            }
          }
        }
        const res = await fetch(`/api/players/${encodeURIComponent(target!)}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Player not found" : "Failed to fetch profile");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setPlayer(data);
        setMatches(data.matchHistory || []);
      } catch (err) {
        console.error(err);
        setError("An error occurred");
      } finally {
        setLoading(false);
      }
    };
    run();
    fetch("/api/players")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setAllPlayers(d))
      .catch(() => { });
  }, [playerNameParam]);

  const mapsList = useMemo(() => Array.from(new Set(matches.map((m) => m.map))).sort(), [matches]);
  const filteredMatches = useMemo(() => applyMatchFilters(matches, filters), [matches, filters]);

  // Series derived from match history (oldest → newest for sparklines).
  const derived = useMemo(() => {
    const chron = [...matches].reverse();
    const kdSeries = chron.map((m) => m.kdr);
    const swingSeries = chron.map((m) => m.eloChange);
    const n = matches.length;

    // Consistency: how stable the per-match K/D is (lower variance = higher).
    let consistency = 0;
    if (n > 1) {
      const mean = kdSeries.reduce((a, b) => a + b, 0) / n;
      const variance = kdSeries.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
      consistency = Math.max(0, Math.min(100, 100 - Math.sqrt(variance) * 60));
    }

    // Longest win streak.
    let longestWin = 0;
    let cur = 0;
    for (const m of chron) {
      if (m.result === "W") {
        cur += 1;
        longestWin = Math.max(longestWin, cur);
      } else cur = 0;
    }

    const avgSwing = n > 0 ? swingSeries.reduce((a, b) => a + Math.abs(b), 0) / n : 0;
    const lastKd = kdSeries.length ? kdSeries[kdSeries.length - 1] : 0;

    return { kdSeries, swingSeries, consistency, longestWin, avgSwing, lastKd };
  }, [matches]);

  // Percentile comparisons against the whole player base.
  const percentiles = useMemo(() => {
    if (!player) return null;
    const kds = allPlayers.map((p) => p.stats.kd).filter((v) => v > 0);
    const wins = allPlayers.map((p) => p.stats.winPercent);
    const hs = allPlayers.map((p) => p.stats.headshotPercent).filter((v) => v > 0);
    const scores = allPlayers.map((p) => p.stats.scorePerGame).filter((v) => v > 0);
    return {
      kd: percentile(player.stats.kd, kds),
      winPercent: percentile(player.stats.winPercent, wins),
      headshotPercent: percentile(player.stats.headshotPercent, hs),
      scorePerGame: percentile(player.stats.scorePerGame, scores),
    };
  }, [player, allPlayers]);

  if (loading) return <ProfileSkeleton />;

  if (error || !player) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">{error || "Player not found"}</h1>
        <Link href="/leaderboards" className="text-hl-gold hover:underline">Return to Rankings</Link>
      </div>
    );
  }

  const s = player.stats;
  const krRatio = s.matchesPlayed > 0 ? s.kills / (s.matchesPlayed * 24) : 0; // approx kills/round
  const killsPerMatch = s.matchesPlayed > 0 ? s.kills / s.matchesPlayed : 0;
  const currentTierIdx = ICON_TIERS.indexOf(player.rank);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid lg:grid-cols-[300px_1fr] gap-6 items-start">
      {/* ================= LEFT SIDEBAR CARD ================= */}
      <div className="space-y-4">
        <Card className="bg-hl-panel border-hl-border p-5 relative overflow-hidden">
          {/* Header + badges sit on the full-bleed equipped card art, which
              fades into the panel right where the bio starts (FACEIT-style). */}
          <div className="relative -mx-5 -mt-5 px-5 pt-5">
          {player.cosmetics?.card?.asset && (
            <div className="absolute inset-0 pointer-events-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={player.cosmetics.card.asset}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-hl-panel/40 to-hl-panel" />
            </div>
          )}
          <div
            className={`flex flex-col items-center text-center relative z-10 ${
              player.cosmetics?.card?.asset ? "pt-10" : ""
            }`}
          >
            <Avatar className="w-28 h-28 border-4 border-hl-border shadow-xl mb-4">
              {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
              <AvatarFallback className="bg-hl-panel-light text-2xl font-bold text-hl-gold">
                {player.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2">
              {player.countryFlag && <Flag src={player.countryFlag} name={player.countryName} className="w-6 h-4" />}
              <h1 className="text-xl font-black text-white">{player.username}</h1>
              <Link href="/settings" className="text-hl-muted hover:text-white"><Settings className="w-4 h-4" /></Link>
            </div>
            {/* Equipped title */}
            {player.cosmetics?.title && (
              <div className="text-xs font-semibold italic text-hl-gold mt-0.5">
                {player.cosmetics.title}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-hl-muted mt-1">
              <MapPin className="w-3.5 h-3.5" /> {player.countryName || player.region} · HyperLeague
            </div>

            <div className="flex items-center gap-2 w-full mt-4">
              {myName && player.username === myName ? (
                <Link
                  href="/friends"
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-hl-border text-white font-bold text-sm hover:bg-hl-panel-light transition-colors"
                >
                  <Users className="w-4 h-4" /> Your Friends
                </Link>
              ) : friendState === "friends" ? (
                <button
                  disabled
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-hl-green/15 text-hl-green border border-hl-green/30 font-bold text-sm cursor-default"
                >
                  <UserPlus className="w-4 h-4" /> Friends
                </button>
              ) : friendState === "pending" ? (
                <button
                  disabled
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-hl-border text-hl-muted font-bold text-sm cursor-default"
                >
                  <UserPlus className="w-4 h-4" /> Requested
                </button>
              ) : (
                <button
                  onClick={addFriend}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity"
                >
                  <UserPlus className="w-4 h-4" /> Add Friend
                </button>
              )}
              <button className="p-2.5 rounded-lg border border-hl-border text-hl-muted hover:text-white hover:bg-hl-panel-light transition-colors">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
            {friendMsg && <div className="mt-2 text-xs text-hl-gold">{friendMsg}</div>}
          </div>

          {/* Equipped badges */}
          {player.cosmetics && player.cosmetics.badges.length > 0 && (
            <div className="mt-5 pt-5 border-t border-hl-border relative z-10">
              <div className="text-[11px] header-caps text-hl-muted mb-2">Badges</div>
              <div className="flex items-center gap-2 flex-wrap">
                {player.cosmetics.badges.map((b) => (
                  <ProfileBadgeIcon key={b.slug} badge={b} />
                ))}
              </div>
            </div>
          )}
          </div>

          <div className="mt-5 pt-5 border-t border-hl-border">
            <div className="text-[11px] header-caps text-hl-muted mb-1">Bio</div>
            <p className="text-sm text-hl-muted">
              Competing in HyperLeague Season 1. Grinding the ladder one match at a time.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-hl-muted">Matches Played</span>
            <span className="font-bold text-white stat-number">{s.matchesPlayed}</span>
          </div>
        </Card>

        {/* Most Played With */}
        <Card className="bg-hl-panel border-hl-border p-5">
          <h3 className="text-sm font-bold text-white header-caps mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-hl-gold" /> Most Played With
          </h3>
          {player.playedWith && player.playedWith.length > 0 ? (
            <div className="space-y-2">
              {player.playedWith.map((p) => (
                <Link
                  key={p.name}
                  href={`/profile?player=${encodeURIComponent(p.name)}`}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="w-7 h-7 border border-hl-border">
                      <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                        {p.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-white truncate group-hover:text-hl-gold transition-colors">{p.name}</span>
                  </div>
                  <span className="text-xs text-hl-muted shrink-0">{p.count}×</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-hl-muted">No shared matches recorded yet.</p>
          )}
        </Card>

        {/* Activity heatmap */}
        <Card className="bg-hl-panel border-hl-border p-5">
          <h3 className="text-sm font-bold text-white header-caps mb-4">Recent Activity</h3>
          <ActivityHeatmap dates={matches.map((m) => m.date)} />
        </Card>
      </div>

      {/* ================= RIGHT CONTENT ================= */}
      <div className="space-y-6 min-w-0">
        {/* Sub-tabs + game selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hl-border">
          <div className="flex items-center gap-6">
            {(["summary", "matches", "stats"] as SubTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`pb-3 text-sm header-caps border-b-2 transition-colors ${tab === t ? "text-hl-gold border-hl-gold" : "text-hl-muted border-transparent hover:text-white"
                  }`}
              >
                {t === "summary" ? "Summary" : t === "matches" ? "Match History" : "Stats"}
              </button>
            ))}
          </div>
          <span className="text-sm text-hl-muted pb-3">Blox Strike</span>
        </div>

        {/* ---------------- SUMMARY ---------------- */}
        {tab === "summary" && (
          <div className="space-y-6">
            {/* Season + skill level */}
            <Card className="relative overflow-hidden bg-hl-panel border-hl-border p-6">
              <div className="absolute left-6 top-5 text-xs header-caps text-hl-muted">Season 1</div>
              {/* radial glow behind the badge */}
              <div className="absolute left-1/2 top-6 -translate-x-1/2 w-44 h-44 bg-hl-gold/10 blur-3xl rounded-full pointer-events-none" />
              <div className="relative flex flex-col items-center pt-5">
                <RankBadge rank={player.rank} size="lg" />
                <div className="stat-number text-4xl text-hl-gold mt-2">{player.elo}</div>
              </div>
              <div className="relative flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-hl-border">
                <span className="text-sm text-hl-muted">
                  <b className="text-white">{s.matchesPlayed}</b> matches ·{" "}
                  <b className="text-white">{s.winPercent.toFixed(0)}%</b> wins
                </span>
                <div className="flex items-center gap-4">
                  {player.countryFlag && (
                    <span className="flex items-center gap-1.5 text-sm text-hl-muted">
                      <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-3.5" />
                      {player.countryName}
                    </span>
                  )}
                  <span className="text-sm text-hl-muted">
                    Peak <b className="text-white stat-number">{player.peakElo}</b>
                  </span>
                </div>
              </div>
            </Card>

            {/* Recent performance */}
            <div className="grid sm:grid-cols-3 gap-4">
              <PerformanceCard label="K/D" value={s.kd.toFixed(2)} series={derived.kdSeries} accent="teal" />
              <PerformanceCard label="Avg Swing" value={`±${derived.avgSwing.toFixed(0)}`} series={derived.swingSeries} accent="gold" />
              <Card className="bg-hl-panel border-hl-border p-4 flex items-center justify-center">
                <ConsistencyDonut percent={derived.consistency} />
              </Card>
            </div>

            {/* ELO graph */}
            <Card className="bg-hl-panel border-hl-border p-5">
              <h2 className="text-sm font-bold text-white header-caps mb-4">Rating Progression</h2>
              {player.eloHistory && player.eloHistory.length > 1 ? (
                <EloGraphFaceit eloHistory={player.eloHistory} matches={matches} />
              ) : (
                <p className="text-sm text-hl-muted py-8 text-center">Not enough matches to chart yet.</p>
              )}
            </Card>

            {/* Stat summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Wins %", value: `${s.winPercent.toFixed(0)}%` },
                { label: "K/D/A", value: `${Math.round(s.kills / Math.max(1, s.matchesPlayed))}/${Math.round(s.deaths / Math.max(1, s.matchesPlayed))}/${Math.round(s.assists / Math.max(1, s.matchesPlayed))}` },
                { label: "K/D", value: s.kd.toFixed(2) },
                { label: "K/R", value: krRatio.toFixed(2) },
                { label: "HS %", value: `${s.headshotPercent.toFixed(0)}%` },
                { label: "Score", value: s.scorePerGame.toString() },
              ].map((stat) => (
                <div key={stat.label} className="bg-hl-panel border border-hl-border rounded-xl p-3 text-center">
                  <div className="stat-number text-lg text-white">{stat.value}</div>
                  <div className="text-[10px] text-hl-muted header-caps mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------------- MATCH HISTORY ---------------- */}
        {tab === "matches" && (
          <div>
            <StatsFilters maps={mapsList} value={filters} onChange={setFilters} count={filteredMatches.length} />
            <Card className="bg-hl-panel border-hl-border p-0 overflow-hidden">
              {matches.length === 0 ? (
                <EmptyState icon={ListChecks} title="No match history" hint="This player hasn't played any recorded matches yet." />
              ) : filteredMatches.length === 0 ? (
                <EmptyState icon={ListChecks} title="No matches match your filters" hint="Try widening the map, result, or time-range filters." />
              ) : (
                <div className="divide-y divide-hl-border">
                  {/* header row */}
                  <div className="hidden md:grid grid-cols-[110px_120px_130px_1fr_70px_80px] gap-3 px-4 py-2.5 text-[10px] header-caps text-hl-muted">
                    <span>Date</span><span>Score</span><span>Rating</span><span>K / D / A</span><span className="text-right">K/D</span><span className="text-right">Score</span>
                  </div>
                  {filteredMatches.map((m) => {
                    const win = m.result === "W";
                    return (
                      <Link
                        key={m.id}
                        href={m.matchId ? `/match/${m.matchId}` : "#"}
                        className={`grid md:grid-cols-[110px_120px_130px_1fr_70px_80px] grid-cols-2 gap-3 px-4 py-3 items-center hover:bg-hl-panel-light/40 transition-colors border-l-4 ${win ? "border-l-hl-green" : "border-l-hl-red"
                          }`}
                      >
                        <span className="text-xs text-hl-muted">{m.date}</span>
                        <span className={`inline-flex items-center gap-2 text-sm font-bold ${win ? "text-hl-green" : "text-hl-red"}`}>
                          <span className={`w-5 text-center rounded ${win ? "bg-hl-green/15" : "bg-hl-red/15"}`}>{m.result}</span>
                          {m.rounds || (win ? "13:—" : "—:13")}
                        </span>
                        <span className="flex items-center gap-2">
                          <RankBadge rank={player.rank} size="sm" />
                          <span className={`text-xs font-bold flex items-center ${m.eloChange >= 0 ? "text-hl-green" : "text-hl-red"}`}>
                            {m.eloChange >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                            {Math.abs(m.eloChange)}
                          </span>
                        </span>
                        <span className="hidden md:block text-sm font-mono text-white">
                          {m.kills} <span className="text-hl-muted">/</span> <span className="text-hl-red">{m.deaths}</span> <span className="text-hl-muted">/</span> <span className="text-hl-teal">{m.assists}</span>
                        </span>
                        <span className={`hidden md:block text-right text-sm font-mono font-semibold ${m.kdr >= 1 ? "text-hl-green" : "text-hl-red"}`}>{m.kdr.toFixed(2)}</span>
                        <span className="hidden md:flex items-center justify-end gap-1 text-right text-sm text-hl-gold font-semibold">
                          {m.score}
                          {m.matchId ? <ArrowUpRight className="w-3.5 h-3.5 text-hl-muted" /> : null}
                        </span>
                        <span className="md:hidden text-right text-sm text-white">{m.map}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ---------------- STATS ---------------- */}
        {tab === "stats" && (
          <div className="space-y-6">
            {/* Skill level progress across tiers */}
            <Card className="bg-hl-panel border-hl-border p-5">
              <h2 className="text-sm font-bold text-white header-caps mb-4">Skill Level</h2>
              <div className="flex items-end justify-between gap-1">
                {ICON_TIERS.map((tier, i) => (
                  <div key={tier} className="flex flex-col items-center gap-2 flex-1">
                    <RankBadge rank={tier} size={i === currentTierIdx ? "md" : "sm"} showGlow={i === currentTierIdx} className={i > currentTierIdx ? "opacity-30" : ""} />
                    <span className={`text-[10px] ${i === currentTierIdx ? "text-hl-gold font-bold" : "text-hl-muted"}`}>{tier}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 w-full bg-hl-base rounded-full h-2">
                <div className="bg-hl-green h-2 rounded-full" style={{ width: `${((currentTierIdx + 1) / ICON_TIERS.length) * 100}%` }} />
              </div>
            </Card>

            {/* Overview cards */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Matches", value: s.matchesPlayed.toString() },
                { label: "Longest Win Streak", value: derived.longestWin.toString() },
                { label: "Win Rate", value: `${s.winPercent.toFixed(0)}%` },
              ].map((c) => (
                <Card key={c.label} className="bg-hl-panel border-hl-border p-4 text-center">
                  <div className="stat-number text-2xl text-hl-gold">{c.value}</div>
                  <div className="text-[10px] text-hl-muted header-caps mt-1">{c.label}</div>
                </Card>
              ))}
            </div>

            {/* Performance statistics */}
            <div className="grid sm:grid-cols-3 gap-4">
              <PerformanceCard label="K/D" value={s.kd.toFixed(2)} series={derived.kdSeries} accent="teal" />
              <PerformanceCard label="Avg Swing" value={`±${derived.avgSwing.toFixed(0)}`} series={derived.swingSeries} accent="gold" />
              <Card className="bg-hl-panel border-hl-border p-4 flex items-center justify-center">
                <ConsistencyDonut percent={derived.consistency} />
              </Card>
            </div>

            {/* ELO graph */}
            <Card className="bg-hl-panel border-hl-border p-5">
              <h2 className="text-sm font-bold text-white header-caps mb-4">Rating Progression</h2>
              {player.eloHistory && player.eloHistory.length > 1 ? (
                <EloGraphFaceit eloHistory={player.eloHistory} matches={matches} />
              ) : (
                <p className="text-sm text-hl-muted py-8 text-center">Not enough matches to chart yet.</p>
              )}
            </Card>

            {/* Performance grid 3x2 with percentiles */}
            {percentiles && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <PercentileStat label="Win Rate" value={`${s.winPercent.toFixed(0)}%`} pct={percentiles.winPercent} />
                <PercentileStat label="Score / Match" value={s.scorePerGame.toString()} pct={percentiles.scorePerGame} />
                <PercentileStat label="K/R" value={krRatio.toFixed(2)} pct={percentiles.kd} />
                <PercentileStat label="K/D" value={s.kd.toFixed(2)} pct={percentiles.kd} />
                <PercentileStat label="Headshot %" value={`${s.headshotPercent.toFixed(0)}%`} pct={percentiles.headshotPercent} />
                <PercentileStat label="Kills / Match" value={killsPerMatch.toFixed(0)} pct={percentiles.scorePerGame} />
              </div>
            )}

            {/* Other stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Total Wins", value: s.wins.toString() },
                { label: "Total Kills", value: s.kills.toLocaleString() },
                { label: "MVPs", value: Math.round(s.avgMvp * s.matchesPlayed).toString() },
              ].map((c) => (
                <Card key={c.label} className="bg-hl-panel border-hl-border p-4 text-center">
                  <div className="stat-number text-xl text-white">{c.value}</div>
                  <div className="text-[10px] text-hl-muted header-caps mt-1">{c.label}</div>
                </Card>
              ))}
            </div>

            {/* Map stats */}
            <Card className="bg-hl-panel border-hl-border p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-hl-border">
                <h2 className="text-sm font-bold text-white header-caps">Map Stats</h2>
              </div>
              {mapsList.length === 0 ? (
                <EmptyState icon={MapPin} title="No map data" hint="Map performance appears once this player has recorded matches." />
              ) : (
                <MapStatsTable matches={matches} />
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/** Stat card with percentile arrow + progress bar (used in the Stats grid). */
function PercentileStat({ label, value, pct }: { label: string; value: string; pct: number }) {
  const above = pct >= 50;
  return (
    <Card className="bg-hl-panel border-hl-border p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-hl-muted header-caps">{label}</div>
        <span className={`flex items-center text-[10px] font-bold ${above ? "text-hl-green" : "text-hl-red"}`}>
          {above ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {pct}%
        </span>
      </div>
      <div className="stat-number text-2xl text-white mt-1">{value}</div>
      <div className="mt-2 w-full bg-hl-base rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${above ? "bg-hl-green" : "bg-hl-gold"}`} style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </Card>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}
