"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { RankTierLetter } from "@/types";
import { Users, Globe, ChevronDown } from "lucide-react";
import { usePlayRegion } from "@/components/use-play-region";
import { PLAY_REGIONS, type PlayRegionId } from "@/lib/regions";

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
  placementDone?: boolean;
  stats: { wins: number; kd: number; winPercent: number; headshotPercent: number; matchesPlayed: number };
}

function SkillPill({ position, rank }: { position: number; rank: RankTierLetter }) {
  const cls =
    position === 1
      ? "bg-[#f5c518] text-black"
      : position === 2
        ? "bg-[#d8d8d8] text-black"
        : position === 3
          ? "bg-[#e67e22] text-black"
          : "bg-[#b02a2a] text-white";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-[3px] ${cls}`}>
      <span className="text-[11px] font-black tabular-nums">#{position}</span>
      <RankBadge rank={rank} size="sm" showGlow={false} className="!w-[18px] !h-[18px]" />
    </span>
  );
}

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-[#1a1a1a] border border-[#2a2a2a] rounded-md h-9 pl-3 pr-8 text-[13px] text-white focus:outline-none focus:border-white/30 min-w-[140px]"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8a8a8a]" />
    </div>
  );
}

export default function LeaderboardsPage() {
  const [players, setPlayers] = useState<ApiPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [myPlayer, setMyPlayer] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [countryFilter, setCountryFilter] = useState("All");
  const { region, setRegion, meta } = usePlayRegion();

  useEffect(() => {
    fetch("/api/players")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setPlayers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setLoggedIn(true);
          setMyPlayer(data.user.playerName || data.user.username);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setCountryFilter("All");
  }, [region]);

  const countryFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          players
            .filter((p) => p.region === region)
            .map((p) => p.countryName)
            .filter((n): n is string => !!n)
        )
      ).sort(),
    [players, region]
  );

  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      if (p.region !== region) return false;
      if (countryFilter !== "All" && p.countryName !== countryFilter) return false;
      return true;
    });
  }, [players, countryFilter, region]);

  const me = useMemo(
    () => (myPlayer ? players.find((p) => p.username === myPlayer) : undefined),
    [players, myPlayer]
  );

  const myCountryRank = useMemo(() => {
    if (!me?.country) return 0;
    return players.filter((p) => p.country === me.country && p.position < me.position).length + 1;
  }, [players, me]);

  const myRegionRank = useMemo(() => {
    if (!me?.region) return 0;
    return players.filter((p) => p.region === me.region && p.position < me.position).length + 1;
  }, [players, me]);

  const ranked = !!me && me.rank !== "UNRANKED" && me.placementDone !== false;

  return (
    <div className="hl-page">
      {loggedIn && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-5 text-[13px]">
          <span className="font-bold text-white">Your rankings</span>
          {me?.countryFlag ? (
            <span className="flex items-center gap-1.5 text-[#8a8a8a]">
              <span className="font-bold text-white">{me.country?.toUpperCase()}</span>
              <Flag src={me.countryFlag} name={me.countryName} className="w-5 h-[14px]" />
              <b className="text-white tabular-nums">{myCountryRank}</b>
            </span>
          ) : null}
          {me?.region ? (
            <span className="flex items-center gap-1.5 text-[#8a8a8a]">
              <span className="font-bold text-white">{me.region}</span>
              <Globe className="w-3.5 h-3.5 text-[#ff5500]" />
              <b className="text-white tabular-nums">{myRegionRank}</b>
            </span>
          ) : null}
          <span className="flex items-center gap-1.5 text-[#8a8a8a]">
            Skill &amp; Elo
            {ranked && me ? (
              <>
                <RankBadge rank={me.rank as RankTierLetter} size="sm" showGlow={false} className="!w-5 !h-5" />
                <b className="text-white tabular-nums">{me.elo.toLocaleString()}</b>
              </>
            ) : (
              <>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-[#3a3a3a] text-[10px] text-[#8a8a8a]">
                  ?
                </span>
                <span className="text-[#8a8a8a]">Unranked</span>
              </>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="text-sm font-bold text-white">{meta.short} Rankings</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect value="s1" onChange={() => {}}>
            <option value="s1">Season 1 (current)</option>
          </FilterSelect>
          <FilterSelect value={countryFilter} onChange={setCountryFilter}>
            <option value="All">All countries</option>
            {countryFilterOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={region} onChange={(v) => setRegion(v as PlayRegionId)}>
            {PLAY_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.short}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      <div className="w-full">
        <div className="grid grid-cols-[56px_1fr_90px_140px_88px] gap-2 px-1 pb-2 text-[11px] font-semibold text-[#6a6a6a] border-b border-white/[0.06]">
          <span>Rank</span>
          <span>Player</span>
          <span className="text-center">Country</span>
          <span className="text-center">Skill level</span>
          <span className="text-right">ELO</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-[#6a6a6a]">Loading…</div>
        ) : filteredPlayers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No players found"
            hint="No players from this region yet. Set your country in Settings to appear on the matching board."
          />
        ) : (
          filteredPlayers.map((player, idx) => {
            const isMe = myPlayer !== null && player.username === myPlayer;
            const boardRank = idx + 1;
            return (
              <Link
                key={player.id}
                href={`/profile?player=${encodeURIComponent(player.username)}`}
                className={`grid grid-cols-[56px_1fr_90px_140px_88px] gap-2 items-center px-1 h-16 border-b border-white/[0.04] ${
                  isMe ? "bg-[#ff5500]/10" : "hover:bg-white/[0.03]"
                }`}
              >
                <span className="text-sm tabular-nums text-[#8a8a8a]">{boardRank}</span>
                <span className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {player.avatarUrl ? (
                    <img
                      src={player.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-md object-cover bg-[#1a1a1a] shrink-0"
                    />
                  ) : (
                    <span className="w-10 h-10 rounded-md bg-[#1a1a1a] text-[#ff5500] text-xs font-bold flex items-center justify-center shrink-0">
                      {player.username.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="text-[15px] font-medium text-white truncate">{player.username}</span>
                </span>
                <span className="flex items-center justify-center">
                  {player.countryFlag ? (
                    <Flag src={player.countryFlag} name={player.countryName} className="w-6 h-4" />
                  ) : (
                    <span className="w-6" />
                  )}
                </span>
                <span className="flex items-center justify-center">
                  {boardRank <= 10 ? (
                    <SkillPill position={boardRank} rank={player.rank as RankTierLetter} />
                  ) : (
                    <RankBadge rank={player.rank as RankTierLetter} size="sm" showGlow={false} className="!w-6 !h-6" />
                  )}
                </span>
                <span className="text-right text-[15px] font-semibold text-white tabular-nums">
                  {player.elo.toLocaleString()}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
