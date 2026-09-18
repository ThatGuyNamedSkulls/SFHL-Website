"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/avatar-frame";
import { RankBadge } from "@/components/rank-badge";
import { GameSkillBar } from "@/components/game-skill-bar";
import { PerformanceCard } from "@/components/performance-card";
import { ConsistencyDonut } from "@/components/consistency-donut";
import { EloGraphFaceit } from "@/components/elo-graph-faceit";
import { RecentPerformance } from "@/components/recent-performance";
import { MapStatsTable } from "@/components/map-stats-table";
import { MetricChart } from "@/components/metric-chart";
import { ProfileInventory } from "@/components/profile-inventory";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { flagPath, countryName as countryLabel, COUNTRY_CHANGE_EVENT } from "@/lib/countries";
import { formatUsername } from "@/lib/format";
import {
  StatsFilters,
  DEFAULT_FILTERS,
  applyMatchFilters,
  MatchFilters,
} from "@/components/stats-filters";
import { RANK_TIERS, getNextRank } from "@/data/ranks";
import { Player, Match, RankTierLetter, ProfileCosmetics, InventoryItem } from "@/types";
import { SubRolePill } from "@/components/sub-role-pill";
import { eloChangeColor, formatSigned } from "@/lib/match-stats";
import {
  UserPlus,
  MapPin,
  Users,
  ListChecks,
  Award,
  Globe,
  Building2,
  UsersRound,
  Swords,
  Share2,
  Pencil,
} from "lucide-react";

type MainTab = "games" | "friends" | "inventory" | "guestbook" | "clubs" | "teams";
type SubTab = "summary" | "matches" | "stats";

interface ProfileFriend {
  name: string;
  avatar: string | null;
  rank: string;
  country: string | null;
  discordUsername?: string | null;
}

interface ProfilePlayer extends Player {
  playedWith?: { name: string; count: number; discordUsername?: string | null; avatar?: string | null }[];
  matchHistory?: Match[];
  regionFlag?: string;
  country?: string | null;
  countryName?: string | null;
  countryFlag?: string | null;
  cosmetics?: ProfileCosmetics;
  friends?: ProfileFriend[];
  inventory?: InventoryItem[];
  rankings?: { overall: number | null; country: number | null; region: number | null };
  discordUsername?: string | null;
  /** Own-ladder gamemode ratings (e.g. the separate 1v1 ladder). */
  modes?: {
    mode: string;
    elo: number;
    rank: string;
    peakElo: number;
    matchesPlayed: number;
    matchesWon: number;
    placementDone: boolean;
    placementGamesPlayed: number;
  }[];
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

function formatMatchWhen(date: string): { day: string; time: string } {
  const raw = date.trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: date, time: "" };
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const hasTime = /\d{1,2}:\d{2}/.test(raw);
  const time = hasTime
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";
  return { day, time };
}

function formatMemberSince(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(date.includes("T") ? date : `${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `Member since ${date}`;
  return `Member since ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function MatchHistoryRow({
  match,
  fallbackRank,
}: {
  match: Match;
  fallbackRank: RankTierLetter;
}) {
  const win = match.result === "W";
  const rank = match.rank || fallbackRank;
  const { day, time } = formatMatchWhen(match.date);
  const eloDelta = match.eloChange ?? 0;
  return (
    <Link
      href={match.matchId ? `/match/${match.matchId}` : "#"}
      className={`grid grid-cols-[76px_1fr_52px_56px_84px] md:grid-cols-[100px_1fr_64px_80px_110px] gap-3 items-center px-4 py-3 hover:bg-white/[0.03] border-l-2 ${
        win ? "border-l-[#2ecc71]" : "border-l-[#e74c3c]"
      }`}
    >
      <span className="leading-tight">
        <span className="block text-[13px] text-white">{day}</span>
        {time ? <span className="block text-[11px] text-[#8a8a8a]">{time}</span> : null}
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <Swords className="w-3.5 h-3.5 text-[#8a8a8a] shrink-0" />
        <RankBadge rank={rank} size="sm" showGlow={false} className="!w-6 !h-6" />
        <span className="text-sm text-[#c8c8c8] truncate">{rank === "UNRANKED" ? "Unranked" : rank}</span>
        <SubRolePill isSub={match.isSub} leftEarly={match.leftEarly} share={match.subShare} />
      </span>
      <span
        className="text-sm font-bold tabular-nums"
        style={{ color: eloChangeColor(eloDelta) }}
      >
        {formatSigned(eloDelta)}
      </span>
      <span className={`text-sm font-bold tabular-nums ${match.kdr >= 1 ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
        {match.kdr.toFixed(2)}
      </span>
      <span className="text-sm tabular-nums text-[#c8c8c8] text-right">
        {match.kills} / {match.deaths} / {match.assists}
      </span>
    </Link>
  );
}
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
    <div className="hl-page-wide grid lg:grid-cols-[300px_1fr] gap-6">
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
            setError("Your Discord account isn't linked to a HyperLeague player yet. Join the Discord server and verify with Bloxlink first.");
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

  useEffect(() => {
    const onCountry = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (!code) return;
      setPlayer((prev) => {
        if (!prev) return prev;
        const own =
          !playerNameParam ||
          (myName != null && (playerNameParam === myName || prev.username === myName));
        if (!own) return prev;
        return {
          ...prev,
          country: code,
          countryName: countryLabel(code),
          countryFlag: flagPath(code),
        };
      });
    };
    window.addEventListener(COUNTRY_CHANGE_EVENT, onCountry);
    return () => window.removeEventListener(COUNTRY_CHANGE_EVENT, onCountry);
  }, [playerNameParam, myName]);

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
      <div className="hl-page-wide py-16 text-center">
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
  const nextTier = getNextRank(player.rank);
  const eloNeeded =
    currentTierIdx >= 0 && nextTier && nextTier.minElo > player.elo
      ? nextTier.minElo - player.elo
      : null;
  const overallRank = player.rankings?.overall ?? null;
  const countryRank = player.rankings?.country ?? null;
  const regionRank = player.rankings?.region ?? null;
  const friends = player.friends ?? [];
  const inventory = player.inventory ?? [];

  const statTiles = [
    { label: "K/D/A", value: `${Math.round(s.kills / Math.max(1, s.matchesPlayed))} / ${Math.round(s.deaths / Math.max(1, s.matchesPlayed))} / ${Math.round(s.assists / Math.max(1, s.matchesPlayed))}` },
    { label: "K/D", value: s.kd.toFixed(2) },
    { label: "K/R", value: krRatio.toFixed(2) },
    { label: "HS %", value: `${s.headshotPercent.toFixed(0)}%` },
  ];

  const performanceRow = (
    <div className="grid sm:grid-cols-3 gap-4">
      <PerformanceCard label="K/D" value={s.kd.toFixed(2)} series={derived.kdSeries} accent="green" />
      <PerformanceCard label="Swing" value={`±${derived.avgSwing.toFixed(0)}`} series={derived.swingSeries} accent="gold" />
      <div className="rounded-xl bg-[#161616] border border-white/[0.06] p-4 flex items-center justify-center">
        <ConsistencyDonut percent={derived.consistency} />
      </div>
    </div>
  );

  const statTileRow = (
    <div className="grid grid-cols-2 gap-3">
      {statTiles.map((stat) => (
        <div key={stat.label} className="bg-[#1c1c1c] border border-white/[0.08] rounded-xl p-4">
          <div className="stat-number text-2xl text-white">{stat.value}</div>
          <div className="text-[12px] text-[#8a8a8a] mt-1">{stat.label}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="hl-page-wide grid lg:grid-cols-[300px_1fr] gap-6 items-start">
      {/* ================= LEFT SIDEBAR ================= */}
      <div className="space-y-5">
        <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] overflow-hidden">
          <div className="relative aspect-[4/5]">
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
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-[#1c1c1c]/40 to-[#1c1c1c]" />
              </>
            ) : (
              <div className="absolute inset-0 bg-[#161616]" />
            )}
            <div className="relative h-full flex flex-col items-center justify-center px-5 text-center">
              <AvatarFrame frame={player.cosmetics?.frame?.asset}>
                <Avatar className="w-[120px] h-[120px] border-0">
                  {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
                  <AvatarFallback className="bg-[#2a2a2a] text-2xl font-bold text-white">
                    {(player.username || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </AvatarFrame>
              <h1 className="mt-5 text-xl font-bold text-white tracking-tight">
                {formatUsername(player.username, player.discordUsername)}
              </h1>
              {player.cosmetics?.title && (
                <div className="text-xs font-semibold italic text-[#ff5500] mt-1">{player.cosmetics.title}</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-white/[0.08]">
            {isOwn ? (
              <Link
                href="/settings"
                className="flex items-center justify-center gap-2 py-3 text-[12px] font-semibold text-[#c8c8c8] hover:text-white hover:bg-white/[0.03]"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit profile
              </Link>
            ) : friendState === "friends" ? (
              <span className="flex items-center justify-center gap-2 py-3 text-[12px] font-semibold text-[#2ecc71]">
                <UserPlus className="w-3.5 h-3.5" /> Friends
              </span>
            ) : friendState === "pending" ? (
              <span className="flex items-center justify-center gap-2 py-3 text-[12px] font-semibold text-[#8a8a8a]">
                Requested
              </span>
            ) : (
              <button
                type="button"
                onClick={() => addFriendByName(player.username, true)}
                className="flex items-center justify-center gap-2 py-3 text-[12px] font-semibold text-[#c8c8c8] hover:text-white hover:bg-white/[0.03]"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add friend
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href).then(
                  () => setFriendMsg("Profile link copied"),
                  () => setFriendMsg("Could not copy link")
                );
              }}
              className="flex items-center justify-center gap-2 py-3 text-[12px] font-semibold text-[#c8c8c8] hover:text-white hover:bg-white/[0.03] border-l border-white/[0.08]"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
          </div>
          {friendMsg && <div className="px-4 py-2 text-xs text-[#ff5500] border-t border-white/[0.08]">{friendMsg}</div>}
        </div>

        {player.cosmetics && player.cosmetics.badges.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-1">
            {player.cosmetics.badges.map((b) => (
              <ProfileBadgeIcon key={b.slug} badge={b} />
            ))}
          </div>
        )}

        <div className="px-1 space-y-3">
          <div className="text-sm font-semibold text-white">
            {formatMemberSince(memberSince) || "Member of Season 1"}
          </div>
          <p className="text-sm text-[#8a8a8a] leading-relaxed">
            Competing in HyperLeague Season 1. Grinding the ladder one match at a time.
          </p>
          {player.countryFlag && (
            <div className="flex items-center gap-2 text-sm text-[#c8c8c8]">
              <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-3.5" />
              {player.countryName}
            </div>
          )}
        </div>

        <div className="px-1 pt-2">
          <div className="text-sm font-semibold text-white mb-2">Game history</div>
          <div className="rounded-lg border border-white/[0.08] bg-[#1c1c1c] px-3 py-2.5 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-md bg-[#ff5500]">
              <Swords className="w-4 h-4 text-white" />
            </span>
            <div>
              <div className="text-sm font-semibold text-white">Strike Force</div>
              <div className="text-[12px] text-[#8a8a8a]">
                {player.careerMatchesPlayed ?? s.matchesPlayed} matches
              </div>
            </div>
          </div>
        </div>

        {player.playedWith && player.playedWith.length > 0 && (
          <div className="px-1 pt-2">
            <div className="text-sm font-semibold text-white mb-3">Most played with</div>
            <div className="space-y-2">
              {player.playedWith.map((p) => (
                <Link
                  key={p.name}
                  href={`/profile?player=${encodeURIComponent(p.name)}`}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="w-7 h-7">
                      {p.avatar ? <AvatarImage src={p.avatar} alt={p.name} /> : null}
                      <AvatarFallback className="bg-[#2a2a2a] text-[10px] font-bold text-white">
                        {(p.name || "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-white truncate group-hover:text-[#ff5500]">{formatUsername(p.name, p.discordUsername)}</span>
                  </div>
                  <span className="text-xs text-[#8a8a8a] shrink-0">{p.count}×</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ================= RIGHT CONTENT ================= */}
      <div className="space-y-6 min-w-0">
        {/* Top-level tabs (FACEIT: GAMES / FRIENDS / INVENTORY) */}
        <div className="flex items-center gap-5 border-b border-white/[0.08]">
          {(
            [
              { id: "games", label: "Games" },
              { id: "friends", label: "Friends" },
              { id: "guestbook", label: "Guestbook" },
              { id: "inventory", label: "Inventory" },
              { id: "clubs", label: "Clubs" },
              { id: "teams", label: "Teams" },
            ] as { id: MainTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setMainTab(t.id)}
              className={`pb-3 text-[13px] font-bold uppercase tracking-wide border-b-2 transition-colors ${
                mainTab === t.id ? "text-[#ff5500] border-[#ff5500]" : "text-[#8a8a8a] border-transparent hover:text-white"
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-md bg-[#1c1c1c] border border-white/[0.08] px-2.5 h-9">
                <span className="flex items-center justify-center w-5 h-5 rounded bg-[#ff5500]">
                  <Swords className="w-3 h-3 text-white" />
                </span>
                <span className="text-sm font-semibold text-white">Strike Force</span>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-[#1c1c1c] border border-white/[0.08] p-1">
                {(["summary", "matches", "stats"] as SubTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3 h-7 rounded text-[13px] font-semibold ${
                      tab === t ? "bg-[#2a2a2a] text-white" : "text-[#8a8a8a] hover:text-white"
                    }`}
                  >
                    {t === "summary" ? "Summary" : t === "matches" ? "Match history" : "Stats"}
                  </button>
                ))}
              </div>
            </div>

            {/* ---------------- SUMMARY ---------------- */}
            {tab === "summary" && (
              <div className="space-y-6">
                <GameSkillBar
                  rank={player.rank}
                  elo={player.elo}
                  header={
                    <>
                      <div>
                        <div className="text-[13px] font-semibold text-white">Season 1</div>
                        <div className="text-[12px] text-[#8a8a8a]">Matchmaking</div>
                      </div>
                      <div className="text-right text-[13px] text-[#8a8a8a]">
                        <b className="text-white">{player.seasonMatchesPlayed ?? s.matchesPlayed}</b> Matches ·{" "}
                        <b className="text-white">
                          {(player.seasonWinPercent ?? s.winPercent).toFixed(1)}%
                        </b>{" "}
                        Win rate
                      </div>
                    </>
                  }
                  footer={
                    (player.countryFlag && countryRank) || regionRank || overallRank ? (
                      <>
                        {player.countryFlag && countryRank && (
                          <span
                            className="flex items-center gap-1.5 text-sm text-[#8a8a8a]"
                            title={`#${countryRank} in ${player.countryName}`}
                          >
                            <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-3.5" />
                            <b className="text-white stat-number">{countryRank.toLocaleString()}</b>
                          </span>
                        )}
                        {regionRank && player.region && (
                          <span
                            className="flex items-center gap-1.5 text-sm text-[#8a8a8a]"
                            title={`#${regionRank} in ${player.region}`}
                          >
                            <span className="text-[11px] font-bold text-white">{player.region}</span>
                            <b className="text-white stat-number">{regionRank.toLocaleString()}</b>
                          </span>
                        )}
                        {overallRank && (
                          <span
                            className="flex items-center gap-1.5 text-sm text-[#8a8a8a]"
                            title={`#${overallRank} overall`}
                          >
                            <Globe className="w-4 h-4 text-[#ff5500]" />
                            <b className="text-white stat-number">{overallRank.toLocaleString()}</b>
                          </span>
                        )}
                      </>
                    ) : undefined
                  }
                />

                {/* Own-ladder gamemodes are retired — 5v5 only. */}

                {/* Recent performance */}
                <RecentPerformance
                  eloHistory={player.eloHistory || []}
                  matches={matches}
                  placementDone={!!player.placementDone}
                  placementGamesPlayed={player.placementGamesPlayed ?? 0}
                  placementGamesTotal={player.placementGamesTotal ?? 3}
                  placementMatches={player.placementMatches ?? []}
                  rank={player.rank}
                  lastSeason={player.lastSeason}
                  lastResetAt={player.lastResetAt}
                  currentElo={player.elo}
                />

                {/* Recent matches */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-[15px] font-bold text-white">Recent matches</h2>
                    <button
                      onClick={() => setTab("matches")}
                      className="text-[12px] text-[#ff5500] hover:underline"
                    >
                      Full match history
                    </button>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] overflow-hidden">
                    {matches.length === 0 ? (
                      <EmptyState icon={ListChecks} title="No match history" hint="This player hasn't played any recorded matches yet." />
                    ) : (
                      <div>
                        <div className="hidden md:grid grid-cols-[100px_1fr_64px_80px_110px] gap-3 px-4 py-2.5 text-[11px] font-semibold text-[#6a6a6a] border-b border-white/[0.06]">
                          <span>Date</span>
                          <span />
                          <span>Elo</span>
                          <span>Rating</span>
                          <span className="text-right">K/D/A</span>
                        </div>
                        {matches.slice(0, 8).map((m) => (
                          <MatchHistoryRow key={m.id} match={m} fallbackRank={player.rank} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- MATCH HISTORY ---------------- */}
            {tab === "matches" && (
              <div>
                <StatsFilters maps={mapsList} value={filters} onChange={setFilters} count={filteredMatches.length} />
                <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] overflow-hidden">
                  {matches.length === 0 ? (
                    <EmptyState icon={ListChecks} title="No match history" hint="This player hasn't played any recorded matches yet." />
                  ) : filteredMatches.length === 0 ? (
                    <EmptyState icon={ListChecks} title="No matches match your filters" hint="Try widening the map, result, or time-range filters." />
                  ) : (
                    <div>
                      <div className="hidden md:grid grid-cols-[100px_1fr_64px_80px_110px] gap-3 px-4 py-2.5 text-[11px] font-semibold text-[#6a6a6a] border-b border-white/[0.06]">
                        <span>Date</span>
                        <span />
                        <span>Elo</span>
                        <span>Rating</span>
                        <span className="text-right">K/D/A</span>
                      </div>
                      {filteredMatches.map((m) => (
                        <MatchHistoryRow key={m.id} match={m} fallbackRank={player.rank} />
                      ))}
                    </div>
                  )}
                </div>
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
                <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-5">
                  {player.eloHistory && player.eloHistory.length > 1 ? (
                    <EloGraphFaceit
                      eloHistory={player.eloHistory}
                      matches={matches}
                      lastResetAt={player.lastResetAt}
                      lastSeason={player.lastSeason}
                      currentElo={player.elo}
                    />
                  ) : (
                    <p className="text-sm text-[#8a8a8a] py-8 text-center">Not enough matches to chart yet.</p>
                  )}
                </div>

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
            <span className="inline-flex items-center rounded-full bg-[#2a2a2a] text-white px-3 py-1 text-xs font-bold mb-4">
              All ({friends.length})
            </span>
            {friends.length === 0 ? (
              <EmptyState icon={Users} title="No friends yet" hint="Friends added on HyperLeague will show up here." />
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {friends.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-3 rounded-lg bg-[#1c1c1c] border border-white/[0.08] px-3 py-2.5 hover:bg-white/[0.03] transition-colors"
                  >
                    <Link href={`/profile?player=${encodeURIComponent(f.name)}`} className="flex items-center gap-3 flex-1 min-w-0">
                      <Avatar className="w-9 h-9">
                        {f.avatar ? <AvatarImage src={f.avatar} /> : null}
                        <AvatarFallback className="bg-[#2a2a2a] text-[11px] font-bold text-white">
                          {(f.name || "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-semibold text-white truncate">{formatUsername(f.name, f.discordUsername)}</span>
                      {f.country && (
                        <Flag src={flagPath(f.country)} name={countryLabel(f.country)} className="w-4 h-3 shrink-0" />
                      )}
                    </Link>
                    <RankBadge rank={(f.rank || "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!w-6 !h-6" />
                    {myName && f.name !== myName && (
                      <button
                        onClick={() => addFriendByName(f.name, false)}
                        title={`Add ${f.name} as a friend`}
                        className="p-1.5 rounded-md text-[#8a8a8a] hover:text-[#ff5500]"
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

        {mainTab === "guestbook" && (
          <GuestbookPanel profileName={player.username} canPost={!!myName} />
        )}

        {mainTab === "clubs" && (
          <EmptyState icon={Building2} title="Clubs" hint="Coming soon." />
        )}

        {mainTab === "teams" && (
          <EmptyState icon={UsersRound} title="Teams" hint="Coming soon." />
        )}
      </div>
    </div>
  );
}

function GuestbookPanel({ profileName, canPost }: { profileName: string; canPost: boolean }) {
  const [entries, setEntries] = useState<{ id: number; fromName: string; message: string; createdAt: number; rank?: string }[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/guestbook?player=${encodeURIComponent(profileName)}`)
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => setEntries([]));
  }, [profileName]);

  const post = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName: profileName, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to post");
      } else if (data.entry) {
        setEntries((prev) => [data.entry, ...prev]);
        setMessage("");
      }
    } catch {
      setError("Failed to post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canPost && (
        <Card className="bg-hl-panel border-hl-border p-4">
          <div className="text-xs header-caps text-hl-muted mb-2">Write a message</div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 280))}
            rows={3}
            placeholder="Say something…"
            className="w-full bg-hl-base border border-hl-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-hl-muted">{message.length}/280</span>
            <button
              type="button"
              onClick={post}
              disabled={busy || !message.trim()}
              className="px-4 py-1.5 rounded-md bg-gold-gradient text-hl-base text-xs font-black header-caps disabled:opacity-50"
            >
              {busy ? "Posting…" : "Post"}
            </button>
          </div>
          {error && <p className="text-xs text-hl-red mt-2">{error}</p>}
        </Card>
      )}
      {entries.length === 0 ? (
        <div className="py-16 text-center">
          <h5 className="text-lg font-semibold text-white">The guestbook is empty</h5>
          <p className="text-sm text-[#8a8a8a] mt-1">Be the first to leave a message.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <Card key={e.id} className="bg-hl-panel border-hl-border px-4 py-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <Link
                  href={`/profile?player=${encodeURIComponent(e.fromName)}`}
                  className="text-sm font-bold text-white hover:text-hl-gold flex items-center gap-2 min-w-0"
                >
                  <RankBadge
                    rank={(e.rank || "UNRANKED") as RankTierLetter}
                    size="sm"
                    showGlow={false}
                    className="!w-5 !h-5 shrink-0"
                  />
                  <span className="truncate">{e.fromName}</span>
                </Link>
                <span className="text-[11px] text-hl-muted">
                  {new Date(e.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-hl-muted whitespace-pre-wrap">{e.message}</p>
            </Card>
          ))}
        </div>
      )}
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
