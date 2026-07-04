"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/avatar-frame";
import { RankBadge } from "@/components/rank-badge";
import { PerformanceCard } from "@/components/performance-card";
import { ConsistencyDonut } from "@/components/consistency-donut";
import { EloGraphFaceit } from "@/components/elo-graph-faceit";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { MapStatsTable } from "@/components/map-stats-table";
import { MetricChart } from "@/components/metric-chart";
import { ProfileInventory } from "@/components/profile-inventory";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { flagPath, countryName as countryLabel } from "@/lib/countries";
import {
  StatsFilters,
  DEFAULT_FILTERS,
  applyMatchFilters,
  MatchFilters,
} from "@/components/stats-filters";
import { RANK_TIERS, getRankByLetter, getNextRank } from "@/data/ranks";
import { Player, Match, RankTierLetter, ProfileCosmetics, InventoryItem } from "@/types";
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
  Globe,
} from "lucide-react";

type MainTab = "games" | "friends" | "inventory";
type SubTab = "summary" | "matches" | "stats";

interface ProfileFriend {
  name: string;
  avatar: string | null;
  rank: string;
  country: string | null;
}

interface ProfilePlayer extends Player {
  playedWith?: { name: string; count: number }[];
  matchHistory?: Match[];
  regionFlag?: string;
  country?: string | null;
  countryName?: string | null;
  countryFlag?: string | null;
  cosmetics?: ProfileCosmetics;
  friends?: ProfileFriend[];
  inventory?: InventoryItem[];
  rankings?: { overall: number | null; country: number | null };
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
        className="w-8 h-8 object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      title={tooltip}
      className="w-8 h-8 rounded-full bg-hl-gold/10 border border-hl-gold/30 flex items-center justify-center"
    >
      <Award className="w-4 h-4 text-hl-gold" />
    </span>
  );
}

/** Ladder of ranked tiers shown on the Stats tab (with elo thresholds). */
const LADDER = RANK_TIERS.filter((t) =>
  ["D", "C", "B", "A1", "A2", "A3", "S1", "S2", "S3"].includes(t.letter)
);

/** FACEIT-style ladder progression colors: white → green → yellow → orange → red. */
const LADDER_COLORS: Record<string, string> = {
  D: "#e8e8e8",
  C: "#4ade80",
  B: "#22c55e",
  A1: "#facc15",
  A2: "#eab308",
  A3: "#f59e0b",
  S1: "#f97316",
  S2: "#ef4444",
  S3: "#dc2626",
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("games");
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

  const addFriendByName = async (toName: string, updateHeader: boolean) => {
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFriendMsg(data.error || "Failed to add friend");
      } else if (data.status === "friends") {
        if (updateHeader) setFriendState("friends");
        setFriendMsg(`You're now friends with ${toName}!`);
      } else if (data.status === "exists") {
        if (updateHeader) setFriendState("pending");
        setFriendMsg("Request already sent.");
      } else {
        if (updateHeader) setFriendState("pending");
        setFriendMsg(`Friend request sent to ${toName}.`);
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
      setMainTab("games");
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

    return { kdSeries, swingSeries, consistency, longestWin, avgSwing };
  }, [matches]);

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
  const isOwn = !!myName && player.username === myName;
  const krRatio = s.matchesPlayed > 0 ? s.kills / (s.matchesPlayed * 24) : 0; // approx kills/round
  const cardArt = player.cosmetics?.card?.asset ?? null;
  const memberSince = matches.length > 0 ? matches[matches.length - 1].date : null;
  // Ladder position: STAR sits above the whole ladder, UNRANKED below it (-1).
  const currentTierIdx =
    player.rank === "STAR" ? LADDER.length : LADDER.findIndex((t) => t.letter === player.rank);
  const tierColor = getRankByLetter(player.rank).color;
  const nextTier = getNextRank(player.rank);
  const eloNeeded =
    currentTierIdx >= 0 && nextTier && nextTier.minElo > player.elo
      ? nextTier.minElo - player.elo
      : null;
  const overallRank = player.rankings?.overall ?? null;
  const countryRank = player.rankings?.country ?? null;
  const friends = player.friends ?? [];
  const inventory = player.inventory ?? [];

  const statTiles = [
    { label: "Wins %", value: `${s.winPercent.toFixed(0)}%` },
    { label: "K/D/A", value: `${Math.round(s.kills / Math.max(1, s.matchesPlayed))}/${Math.round(s.deaths / Math.max(1, s.matchesPlayed))}/${Math.round(s.assists / Math.max(1, s.matchesPlayed))}` },
    { label: "K/D", value: s.kd.toFixed(2) },
    { label: "K/R", value: krRatio.toFixed(2) },
    { label: "HS %", value: `${s.headshotPercent.toFixed(0)}%` },
    { label: "Score", value: s.scorePerGame.toString() },
  ];

  const performanceRow = (
    <div className="grid sm:grid-cols-3 gap-4">
      <PerformanceCard label="K/D" value={s.kd.toFixed(2)} series={derived.kdSeries} accent="teal" />
      <PerformanceCard label="Avg Swing" value={`±${derived.avgSwing.toFixed(0)}`} series={derived.swingSeries} accent="gold" />
      <Card className="bg-hl-panel border-hl-border p-4 flex items-center justify-center">
        <ConsistencyDonut percent={derived.consistency} />
      </Card>
    </div>
  );

  const statTileRow = (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {statTiles.map((stat) => (
        <div key={stat.label} className="bg-hl-panel border border-hl-border rounded-xl p-3 text-center">
          <div className="stat-number text-lg text-white">{stat.value}</div>
          <div className="text-[10px] text-hl-muted header-caps mt-0.5">{stat.label}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid lg:grid-cols-[300px_1fr] gap-6 items-start">
      {/* ================= LEFT SIDEBAR ================= */}
      <div className="space-y-4">
        {/* Portrait profile card (equipped card art as full background) */}
        <Card className="bg-hl-panel border-hl-border p-0 overflow-hidden">
          <div className="relative aspect-[3/4]">
            {cardArt ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardArt}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-hl-panel" />
              </>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-hl-panel-light to-hl-base" />
            )}
            <div className="relative h-full flex flex-col items-center justify-center px-4 text-center">
              <AvatarFrame frame={player.cosmetics?.frame?.asset}>
                <Avatar className="w-28 h-28 border-4 border-hl-base/70 shadow-xl">
                  {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-2xl font-bold text-hl-gold">
                    {player.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </AvatarFrame>
              <div className="flex items-center gap-2 mt-4">
                <h1 className="text-xl font-black text-white drop-shadow">{player.username}</h1>
                {isOwn && (
                  <Link href="/settings" className="text-hl-muted hover:text-white">
                    <Settings className="w-4 h-4" />
                  </Link>
                )}
              </div>
              {player.cosmetics?.title && (
                <div className="text-xs font-semibold italic text-hl-gold mt-1 drop-shadow">
                  {player.cosmetics.title}
                </div>
              )}
            </div>
          </div>

          {/* Action row */}
          <div className="p-4 flex items-center gap-2 border-t border-hl-border">
            {isOwn ? (
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
                onClick={() => addFriendByName(player.username, true)}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity"
              >
                <UserPlus className="w-4 h-4" /> Add Friend
              </button>
            )}
            <button className="p-2.5 rounded-lg border border-hl-border text-hl-muted hover:text-white hover:bg-hl-panel-light transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
          {friendMsg && <div className="px-4 pb-3 text-xs text-hl-gold">{friendMsg}</div>}
        </Card>

        {/* Member info */}
        <Card className="bg-hl-panel border-hl-border p-5 space-y-3">
          <div className="text-sm font-bold text-white">
            {memberSince ? `Member since ${memberSince}` : "Member of Season 1"}
          </div>
          <p className="text-sm text-hl-muted">
            Competing in HyperLeague Season 1. Grinding the ladder one match at a time.
          </p>
          {player.countryFlag && (
            <div className="flex items-center gap-2 text-sm text-hl-muted">
              <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-3.5" />
              {player.countryName}
            </div>
          )}
        </Card>

        {/* Equipped badges */}
        {player.cosmetics && player.cosmetics.badges.length > 0 && (
          <Card className="bg-hl-panel border-hl-border p-5">
            <div className="flex items-center gap-2 flex-wrap">
              {player.cosmetics.badges.map((b) => (
                <ProfileBadgeIcon key={b.slug} badge={b} />
              ))}
            </div>
            <button
              onClick={() => setMainTab("inventory")}
              className="mt-3 text-[11px] header-caps text-hl-muted hover:text-white transition-colors"
            >
              View all
            </button>
          </Card>
        )}

        {/* Activity heatmap */}
        <Card className="bg-hl-panel border-hl-border p-5">
          <h3 className="text-sm font-bold text-white mb-1">
            Recent Activity <span className="text-hl-muted font-normal text-xs">Last 90 days</span>
          </h3>
          <div className="mt-3">
            <ActivityHeatmap dates={matches.map((m) => m.date)} />
          </div>
          <div className="mt-3 text-xs text-hl-muted">
            <b className="text-white stat-number">{s.matchesPlayed}</b> Matches Played
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
      </div>

      {/* ================= RIGHT CONTENT ================= */}
      <div className="space-y-6 min-w-0">
        {/* Top-level tabs (FACEIT: GAMES / FRIENDS / INVENTORY) */}
        <div className="flex items-center gap-6 border-b border-hl-border">
          {(
            [
              { id: "games", label: "Games" },
              { id: "friends", label: `Friends` },
              { id: "inventory", label: "Inventory" },
            ] as { id: MainTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setMainTab(t.id)}
              className={`pb-3 text-sm header-caps border-b-2 transition-colors ${
                mainTab === t.id ? "text-hl-gold border-hl-gold" : "text-hl-muted border-transparent hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ================= GAMES ================= */}
        {mainTab === "games" && (
          <>
            {/* Sub-tabs + game label */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hl-border">
              <div className="flex items-center gap-6">
                {(["summary", "matches", "stats"] as SubTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`pb-3 text-sm border-b-2 transition-colors font-semibold ${
                      tab === t ? "text-hl-gold border-hl-gold" : "text-hl-muted border-transparent hover:text-white"
                    }`}
                  >
                    {t === "summary" ? "Summary" : t === "matches" ? "Match history" : "Stats"}
                  </button>
                ))}
              </div>
              <span className="text-sm text-hl-muted pb-3">Blox Strike</span>
            </div>

            {/* ---------------- SUMMARY ---------------- */}
            {tab === "summary" && (
              <div className="space-y-6">
                {/* Season banner — glow tinted with the rank's own color */}
                <Card className="relative overflow-hidden bg-hl-panel border-hl-border p-6">
                  <div
                    className="absolute inset-x-0 top-0 h-32 pointer-events-none"
                    style={{ background: `linear-gradient(to bottom, ${tierColor}2b, transparent)` }}
                  />
                  <div
                    className="absolute left-1/2 top-4 -translate-x-1/2 w-56 h-56 blur-3xl rounded-full pointer-events-none"
                    style={{ backgroundColor: `${tierColor}26` }}
                  />
                  <div className="relative text-xs header-caps text-hl-muted">Season 1</div>
                  <div className="relative flex flex-col items-center pt-2 pb-1">
                    <RankBadge rank={player.rank} size="lg" />
                    <div className="stat-number text-4xl text-white mt-2">{player.elo}</div>
                  </div>
                  <div className="relative flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-hl-border">
                    <span className="text-sm text-hl-muted">
                      <b className="text-white">{s.matchesPlayed}</b> matches ·{" "}
                      <b className="text-white">{s.winPercent.toFixed(1)}%</b> wins
                    </span>
                    <div className="flex items-center gap-4">
                      {player.countryFlag && countryRank && (
                        <span
                          className="flex items-center gap-1.5 text-sm text-hl-muted"
                          title={`#${countryRank} in ${player.countryName}`}
                        >
                          <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-3.5" />
                          <b className="text-white stat-number">{countryRank.toLocaleString()}</b>
                        </span>
                      )}
                      {overallRank && (
                        <span
                          className="flex items-center gap-1.5 text-sm text-hl-muted"
                          title={`#${overallRank} overall`}
                        >
                          <Globe className="w-4 h-4 text-hl-gold" />
                          <b className="text-white stat-number">{overallRank.toLocaleString()}</b>
                        </span>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Recent performance */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-bold text-white">Recent performance</h2>
                    <button
                      onClick={() => setTab("stats")}
                      className="text-[11px] header-caps text-hl-gold hover:underline"
                    >
                      See more stats
                    </button>
                  </div>
                  <div className="text-xs text-hl-muted mb-4">
                    Last {Math.min(30, matches.length)} Matches
                  </div>
                  {performanceRow}
                </div>

                {/* ELO graph */}
                <Card className="bg-hl-panel border-hl-border p-5">
                  {player.eloHistory && player.eloHistory.length > 1 ? (
                    <EloGraphFaceit eloHistory={player.eloHistory} matches={matches} />
                  ) : (
                    <p className="text-sm text-hl-muted py-8 text-center">Not enough matches to chart yet.</p>
                  )}
                </Card>

                {statTileRow}

                {/* Recent matches */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-white">Recent matches</h2>
                    <button
                      onClick={() => setTab("matches")}
                      className="text-[11px] header-caps text-hl-gold hover:underline"
                    >
                      Full match history
                    </button>
                  </div>
                  <Card className="bg-hl-panel border-hl-border p-0 overflow-hidden">
                    {matches.length === 0 ? (
                      <EmptyState icon={ListChecks} title="No match history" hint="This player hasn't played any recorded matches yet." />
                    ) : (
                      <div className="divide-y divide-hl-border">
                        <div className="hidden md:grid grid-cols-[100px_100px_110px_1fr_60px_70px_110px] gap-3 px-4 py-2.5 text-[10px] header-caps text-hl-muted">
                          <span>Date</span><span>Score</span><span>Rating</span><span>K / D / A</span><span className="text-right">K/D</span><span className="text-right">Score</span><span className="text-right">Map</span>
                        </div>
                        {matches.slice(0, 5).map((m) => {
                          const win = m.result === "W";
                          return (
                            <Link
                              key={m.id}
                              href={m.matchId ? `/match/${m.matchId}` : "#"}
                              className={`grid md:grid-cols-[100px_100px_110px_1fr_60px_70px_110px] grid-cols-2 gap-3 px-4 py-3 items-center hover:bg-hl-panel-light/40 transition-colors border-l-4 ${
                                win ? "border-l-hl-green" : "border-l-hl-red"
                              }`}
                            >
                              <span className="text-xs text-hl-muted">{m.date}</span>
                              <span className={`inline-flex items-center gap-2 text-sm font-bold ${win ? "text-hl-green" : "text-hl-red"}`}>
                                <span className={`w-5 text-center rounded ${win ? "bg-hl-green/15" : "bg-hl-red/15"}`}>{m.result}</span>
                                {m.rounds || (win ? "13:—" : "—:13")}
                              </span>
                              <span className={`text-xs font-bold flex items-center ${m.eloChange >= 0 ? "text-hl-green" : "text-hl-red"}`}>
                                {m.eloChange >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                {Math.abs(m.eloChange)}
                                <span className={`ml-2 px-1.5 rounded text-[10px] ${m.kdr >= 1 ? "bg-hl-green/15 text-hl-green" : "bg-hl-red/15 text-hl-red"}`}>
                                  {m.kdr.toFixed(2)}
                                </span>
                              </span>
                              <span className="hidden md:block text-sm font-mono text-white">
                                {m.kills} <span className="text-hl-muted">/</span> <span className="text-hl-red">{m.deaths}</span> <span className="text-hl-muted">/</span> <span className="text-hl-teal">{m.assists}</span>
                              </span>
                              <span className={`hidden md:block text-right text-sm font-mono font-semibold ${m.kdr >= 1 ? "text-hl-green" : "text-hl-red"}`}>{m.kdr.toFixed(2)}</span>
                              <span className="hidden md:block text-right text-sm text-hl-gold font-semibold">{m.score}</span>
                              <span className="flex items-center justify-end gap-1 text-right text-sm text-white">
                                {m.map}
                                {m.matchId ? <ArrowUpRight className="w-3.5 h-3.5 text-hl-muted" /> : null}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </Card>
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
                {/* Elo + skill-level ladder */}
                <Card className="bg-hl-panel border-hl-border p-5">
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <div className="flex items-center gap-3">
                      <RankBadge rank={player.rank} size="md" />
                      <div>
                        <div className="stat-number text-2xl text-white">{player.elo}</div>
                        <div className="text-xs text-hl-muted">Season 1</div>
                      </div>
                    </div>
                    {eloNeeded !== null && (
                      <div className="text-right">
                        <div className="stat-number text-lg text-white">{eloNeeded}</div>
                        <div className="text-xs text-hl-muted">Elo needed to next skill rank</div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-1.5">
                    {LADDER.map((tier, i) => {
                      const achieved = i < currentTierIdx;
                      const isCurrent = i === currentTierIdx;
                      // Fill: full for passed tiers, partial for the current one
                      // (progress toward the next threshold), empty beyond.
                      const span = tier.maxElo + 1 - tier.minElo;
                      const fillPct = achieved
                        ? 100
                        : isCurrent
                          ? Math.max(6, Math.min(100, ((player.elo - tier.minElo) / span) * 100))
                          : 0;
                      return (
                        <div key={tier.letter} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                          <RankBadge
                            rank={tier.letter}
                            size={isCurrent ? "md" : "sm"}
                            showGlow={isCurrent}
                            className={!achieved && !isCurrent ? "opacity-30 grayscale" : ""}
                          />
                          <span className={`text-[10px] stat-number ${isCurrent ? "text-white font-bold" : "text-hl-muted"}`}>
                            {tier.minElo}
                          </span>
                          <span className="h-1 w-full rounded-full bg-hl-border overflow-hidden">
                            {fillPct > 0 && (
                              <span
                                className="block h-full rounded-full"
                                style={{ width: `${fillPct}%`, backgroundColor: LADDER_COLORS[tier.letter] }}
                              />
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Overview tiles */}
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Matches", value: s.matchesPlayed.toString() },
                    { label: "Longest Win Streak", value: derived.longestWin.toString() },
                    { label: "Win Rate %", value: s.winPercent.toFixed(0) },
                  ].map((c) => (
                    <Card key={c.label} className="bg-hl-panel border-hl-border p-4 text-center">
                      <div className="stat-number text-2xl text-hl-gold">{c.value}</div>
                      <div className="text-[10px] text-hl-muted header-caps mt-1">{c.label}</div>
                    </Card>
                  ))}
                </div>

                {/* Performance statistics */}
                <div>
                  <h2 className="text-sm font-bold text-white mb-4">Performance statistics</h2>
                  {performanceRow}
                </div>

                {/* ELO graph */}
                <Card className="bg-hl-panel border-hl-border p-5">
                  {player.eloHistory && player.eloHistory.length > 1 ? (
                    <EloGraphFaceit eloHistory={player.eloHistory} matches={matches} />
                  ) : (
                    <p className="text-sm text-hl-muted py-8 text-center">Not enough matches to chart yet.</p>
                  )}
                </Card>

                {statTileRow}

                {/* Per-match metric chart */}
                <Card className="bg-hl-panel border-hl-border p-5">
                  <MetricChart matches={matches} />
                </Card>

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
          </>
        )}

        {/* ================= FRIENDS ================= */}
        {mainTab === "friends" && (
          <div>
            <span className="inline-block bg-gold-gradient text-hl-base rounded-full px-3 py-1 text-xs font-bold mb-4">
              All ({friends.length})
            </span>
            {friends.length === 0 ? (
              <EmptyState icon={Users} title="No friends yet" hint="Friends added on HyperLeague will show up here." />
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {friends.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-3 rounded-lg bg-hl-panel border border-hl-border px-3 py-2.5 hover:bg-hl-panel-light/40 transition-colors"
                  >
                    <Link href={`/profile?player=${encodeURIComponent(f.name)}`} className="flex items-center gap-3 flex-1 min-w-0">
                      <Avatar className="w-9 h-9 border border-hl-border">
                        {f.avatar ? <AvatarImage src={f.avatar} /> : null}
                        <AvatarFallback className="bg-hl-panel-light text-[11px] font-bold text-hl-gold">
                          {f.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-bold text-white truncate">{f.name}</span>
                      {f.country && (
                        <Flag src={flagPath(f.country)} name={countryLabel(f.country)} className="w-4 h-3 shrink-0" />
                      )}
                    </Link>
                    <RankBadge rank={(f.rank || "UNRANKED") as RankTierLetter} size="sm" showGlow={false} />
                    {myName && f.name !== myName && (
                      <button
                        onClick={() => addFriendByName(f.name, false)}
                        title={`Add ${f.name} as a friend`}
                        className="p-1.5 rounded-lg border border-hl-border text-hl-muted hover:text-hl-gold hover:border-hl-gold/40 transition-colors"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= INVENTORY ================= */}
        {mainTab === "inventory" && (
          <ProfileInventory key={player.username} items={inventory} isOwn={isOwn} />
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}
