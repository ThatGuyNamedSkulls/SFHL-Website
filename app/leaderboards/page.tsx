"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { RankTierLetter } from "@/types";
import { Users, Globe, ChevronDown, Swords } from "lucide-react";
import { useLeaderboardRegion } from "@/components/use-play-region";
import { PLAY_REGIONS, isGlobalRegion, regionMeta, type PlayRegionId } from "@/lib/regions";
import { countryName, flagPath, COUNTRY_CHANGE_EVENT } from "@/lib/countries";
import { countryToPlayRegion } from "@/lib/country-regions";
import { useSession } from "@/components/session-provider";
import { apiGetJson } from "@/lib/client-api";
import { ClubTaggedName } from "@/components/club-identity";
import { PRO_DIVISION_WEIGHTS } from "@/lib/pro-league";
import { LEVEL_NAMES } from "@/lib/league-standings";

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
  clubTag?: string | null;
  stats: { wins: number; kd: number; winPercent: number; headshotPercent: number; matchesPlayed: number };
  /** Pro ladder only: the league matches that earned it (league v2 C6). */
  league?: {
    matches: number;
    lastDelta: number;
    division: string | null;
    code: string | null;
    team: { id: string; name: string; tag: string } | null;
  } | null;
}

/** The Pro tab's header: where Pro Elo comes from, and each division's weight. */
function ProLadderIntro() {
  return (
    <div className="w-full rounded-xl border border-[#a855f7]/25 bg-[#a855f7]/[0.06] px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-black text-white">
        <Swords className="h-4 w-4 text-[#d8b4fe]" /> Earned in league matches
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-[#a0a0a0]">
        Every league match in Open 10 and above counts, for the players on its saved scoreboard. Everyone starts at 0;
        higher divisions give more.{" "}
        <Link href="/league" className="font-bold text-[#d8b4fe] hover:underline">
          Go to the League
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(PRO_DIVISION_WEIGHTS).map(([code, w]) => (
          <span key={code} className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] font-bold text-white/80">
            {LEVEL_NAMES[code]} <span className="text-[#d8b4fe]">×{w.toFixed(1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DivisionChip({ name }: { name: string | null }) {
  if (!name) return <span className="text-[#6a6a6a]">—</span>;
  return (
    <span className="inline-block max-w-full truncate rounded-md border border-[#a855f7]/30 bg-[#a855f7]/10 px-2 py-0.5 text-[11px] font-bold text-[#d8b4fe]">
      {name}
    </span>
  );
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
        className="appearance-none bg-[#1a1a1a] border border-[#2a2a2a] rounded-md h-9 pl-3 pr-8 text-[13px] text-white focus:outline-none focus:border-white/30 w-full min-w-0 sm:w-auto sm:min-w-[140px]"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8a8a8a]" />
    </div>
  );
}

function LeaderboardsInner() {
  const [players, setPlayers] = useState<ApiPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  // "main" = the 5v5 ladder; "pro" = the Pro ladder, earned in league matches
  // (Open10 and above). ?mode=pro opens it (the dashboard's Pro Ladder card).
  const initialLadder = useSearchParams().get("mode") === "pro" ? "pro" : "main";
  const [ladder, setLadder] = useState<"main" | "pro">(initialLadder);
  const { session } = useSession();
  const loggedIn = !!session;
  const myPlayer = session?.playerName || session?.username || null;
  const [countryFilter, setCountryFilter] = useState("All");
  const { region, setRegion, meta } = useLeaderboardRegion();

  useEffect(() => {
    apiGetJson<ApiPlayer[]>(ladder === "pro" ? "/api/players?mode=pro" : "/api/players")
      .then(({ ok, json }) => {
        setPlayers(ok && Array.isArray(json) ? json : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ladder]);

  const pickLadder = (next: "main" | "pro") => {
    if (next === ladder) return;
    setLoading(true);
    setLadder(next);
  };

  useEffect(() => {
    const onCountry = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (!code || !myPlayer) return;
      const playRegion = countryToPlayRegion(code);
      setPlayers((prev) =>
        prev.map((p) =>
          p.username === myPlayer
            ? {
                ...p,
                country: code,
                countryName: countryName(code),
                countryFlag: flagPath(code),
                region: playRegion ?? p.region,
                regionFlag: playRegion ? regionMeta(playRegion).short : p.regionFlag,
              }
            : p
        )
      );
    };
    window.addEventListener(COUNTRY_CHANGE_EVENT, onCountry);
    return () => window.removeEventListener(COUNTRY_CHANGE_EVENT, onCountry);
  }, [myPlayer]);

  useEffect(() => {
    setCountryFilter("All");
  }, [region]);

  const countryFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          players
            .filter((p) => isGlobalRegion(region) || p.region === region)
            .map((p) => p.countryName)
            .filter((n): n is string => !!n)
        )
      ).sort(),
    [players, region]
  );

  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      if (!isGlobalRegion(region) && p.region !== region) return false;
      if (countryFilter !== "All" && p.countryName !== countryFilter) return false;
      return true;
    });
  }, [players, countryFilter, region]);

  const unsetCountryCount = useMemo(
    () => players.filter((p) => !p.country).length,
    [players]
  );

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

  const ranked = !!me && me.placementDone !== false && me.rank !== "UNRANKED";

  const isPlacing = (p: ApiPlayer) => p.placementDone === false || p.rank === "UNRANKED";

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
          <span className="flex items-center gap-1.5 text-[#8a8a8a]">
            <span className="font-bold text-white">Global</span>
            <Globe className="w-3.5 h-3.5 text-[#ff5500]" />
            <b className="text-white tabular-nums">{me?.position ?? 0}</b>
          </span>
          {me?.region ? (
            <span className="flex items-center gap-1.5 text-[#8a8a8a]">
              <span className="font-bold text-white">{me.region}</span>
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
        <div className="inline-flex rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Ladder">
          {(
            [
              ["main", "5v5"],
              ["pro", "Pro"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={ladder === id}
              onClick={() => pickLadder(id)}
              className={`h-7 rounded-md px-3 text-[12px] font-bold ${
                ladder === id
                  ? id === "pro"
                    ? "bg-[#a855f7]/20 text-[#d8b4fe]"
                    : "bg-white/10 text-white"
                  : "text-[#8a8a8a] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <h2 className="text-sm font-bold text-white">
          {meta.short} {ladder === "pro" ? "Pro " : ""}Rankings
        </h2>
        {ladder === "pro" ? <ProLadderIntro /> : null}
        {!isGlobalRegion(region) && unsetCountryCount > 0 ? (
          <button
            type="button"
            onClick={() => setRegion("GLOBAL")}
            className="text-[12px] text-[#8a8a8a] hover:text-white"
          >
            {unsetCountryCount} new {unsetCountryCount === 1 ? "player hasn’t" : "players haven’t"} set a
            country — view Global
          </button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2 w-full sm:w-auto">
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
        {ladder === "pro" ? (
          <div className="hidden md:grid grid-cols-[56px_1fr_160px_110px_70px_120px] gap-2 px-1 pb-2 text-[11px] font-semibold text-[#6a6a6a] border-b border-white/[0.06]">
            <span>Rank</span>
            <span>Player</span>
            <span>Last division</span>
            <span className="text-center">League matches</span>
            <span className="text-center">Last</span>
            <span className="text-right">Pro ELO</span>
          </div>
        ) : (
          <div className="hidden md:grid grid-cols-[56px_1fr_90px_140px_88px] gap-2 px-1 pb-2 text-[11px] font-semibold text-[#6a6a6a] border-b border-white/[0.06]">
            <span>Rank</span>
            <span>Player</span>
            <span className="text-center">Country</span>
            <span className="text-center">Skill level</span>
            <span className="text-right">ELO</span>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-[#6a6a6a]">Loading…</div>
        ) : filteredPlayers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={ladder === "pro" && players.length === 0 ? "No Pro ratings yet" : "No players found"}
            hint={
              ladder === "pro" && players.length === 0
                ? "Play a league match in Open10 or above to get on the Pro ladder."
                : isGlobalRegion(region)
                  ? "No players match your filters."
                  : "No players from this region yet. Set your country in Settings to appear on the matching board."
            }
          />
        ) : (
          filteredPlayers.map((player, idx) => {
            const isMe = myPlayer !== null && player.username === myPlayer;
            const boardRank = idx + 1;
            const placing = isPlacing(player);
            const displayRank = placing ? "UNRANKED" : (player.rank as RankTierLetter);
            if (ladder === "pro") {
              const lg = player.league ?? null;
              return (
                <Link
                  key={player.id}
                  href={`/profile?player=${encodeURIComponent(player.username)}`}
                  className={`grid grid-cols-[32px_1fr_auto] md:grid-cols-[56px_1fr_160px_110px_70px_120px] gap-2 items-center px-1 min-h-14 py-2 md:h-16 md:py-0 border-b border-white/[0.04] ${
                    isMe ? "bg-[#ff5500]/10" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="text-sm tabular-nums text-[#8a8a8a]">{boardRank}</span>
                  <span className="flex items-center gap-3 min-w-0">
                    {player.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
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
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        {player.countryFlag ? (
                          <Flag src={player.countryFlag} name={player.countryName} className="w-5 h-[14px] shrink-0" />
                        ) : null}
                        <span className="text-[15px] font-medium text-white truncate">
                          <ClubTaggedName name={player.username} tag={player.clubTag} />
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-[#8a8a8a]">
                        {lg?.team ? `${lg.team.name} [${lg.team.tag}]` : "League player"}
                        <span className="md:hidden">
                          {lg?.division ? ` · ${lg.division}` : ""}
                          {lg ? ` · ${lg.matches} match${lg.matches === 1 ? "" : "es"}` : ""}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="hidden md:block min-w-0">
                    <DivisionChip name={lg?.division ?? null} />
                  </span>
                  <span className="hidden md:block text-center text-sm tabular-nums text-white/80">{lg?.matches ?? player.stats.matchesPlayed}</span>
                  <span
                    className={`hidden md:block text-center text-sm font-bold tabular-nums ${
                      !lg || lg.lastDelta === 0 ? "text-[#8a8a8a]" : lg.lastDelta > 0 ? "text-hl-green" : "text-hl-red"
                    }`}
                  >
                    {lg ? (lg.lastDelta > 0 ? `+${lg.lastDelta}` : lg.lastDelta) : "—"}
                  </span>
                  <span className="flex items-center justify-end gap-2">
                    <RankBadge rank={displayRank} size="sm" showGlow={false} className="!w-6 !h-6" />
                    <span className={`text-[15px] font-semibold tabular-nums ${placing ? "text-[#8a8a8a]" : "text-white"}`}>
                      {placing ? "—" : player.elo.toLocaleString()}
                    </span>
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={player.id}
                href={`/profile?player=${encodeURIComponent(player.username)}`}
                className={`grid grid-cols-[32px_1fr_auto] md:grid-cols-[56px_1fr_90px_140px_88px] gap-2 items-center px-1 min-h-14 py-2 md:h-16 md:py-0 border-b border-white/[0.04] ${
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
                  <span className="text-[15px] font-medium text-white truncate">
                    <ClubTaggedName name={player.username} tag={player.clubTag} />
                  </span>
                  <span className="md:hidden shrink-0">
                    <RankBadge rank={displayRank} size="sm" showGlow={false} className="!w-5 !h-5" />
                  </span>
                </span>
                <span className="hidden md:flex items-center justify-center">
                  {player.countryFlag ? (
                    <Flag src={player.countryFlag} name={player.countryName} className="w-6 h-4" />
                  ) : (
                    <span className="w-6" />
                  )}
                </span>
                <span className="hidden md:flex items-center justify-center">
                  {placing ? (
                    <RankBadge rank="UNRANKED" size="sm" showGlow={false} className="!w-6 !h-6" />
                  ) : boardRank <= 10 ? (
                    <SkillPill position={boardRank} rank={displayRank} />
                  ) : (
                    <RankBadge rank={displayRank} size="sm" showGlow={false} className="!w-6 !h-6" />
                  )}
                </span>
                <span className={`text-right text-[15px] font-semibold tabular-nums ${placing ? "text-[#8a8a8a]" : "text-white"}`}>
                  {placing ? "—" : player.elo.toLocaleString()}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function LeaderboardsPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-[#6a6a6a]">Loading…</div>}>
      <LeaderboardsInner />
    </Suspense>
  );
}
