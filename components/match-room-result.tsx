"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { MapThumb } from "@/components/map-thumb";
import { MatchDetail, MatchPlayerStats, RankTierLetter } from "@/types";
import {
  ratingColor,
  swingColor,
  eloChangeColor,
  formatSigned,
  SWING_GREAT,
  STAT_ESTIMATE_HINT,
} from "@/lib/match-stats";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { cn } from "@/lib/utils";
import { Calendar, Star, Swords } from "lucide-react";

function initials(name: string) {
  return (name || "?").slice(0, 2).toUpperCase();
}

function PlayerCard({
  player,
  align = "left",
}: {
  player: MatchPlayerStats;
  align?: "left" | "right";
}) {
  return (
    <Link
      href={`/profile?player=${encodeURIComponent(player.username)}`}
      className={cn(
        "flex items-center gap-2.5 rounded-lg bg-[#1c1c1c] border border-white/[0.06] px-2.5 py-2 hover:border-white/15 transition-colors",
        align === "right" && "flex-row-reverse text-right"
      )}
    >
      <Avatar className="w-8 h-8 shrink-0">
        {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt={player.username} /> : null}
        <AvatarFallback className="bg-[#2a2a2a] text-[10px] font-bold text-white">
          {initials(player.username)}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-semibold text-white truncate flex-1">{player.username}</span>
      {typeof player.elo === "number" && player.elo > 0 && (
        <span className="text-[12px] tabular-nums text-[#8a8a8a] shrink-0">{player.elo}</span>
      )}
      <span
        className="text-[12px] font-bold tabular-nums shrink-0"
        style={{ color: eloChangeColor(player.eloChange ?? 0) }}
      >
        {formatSigned(player.eloChange ?? 0)}
      </span>
      <RankBadge
        rank={(player.rank || "UNRANKED") as RankTierLetter}
        size="sm"
        showGlow={false}
        className="!w-5 !h-5 shrink-0"
      />
    </Link>
  );
}

function Overview({ match }: { match: MatchDetail }) {
  const teamA = match.players.filter((p) => p.team === "A");
  const teamB = match.players.filter((p) => p.team === "B");

  let when = match.date;
  const raw = (match.timestamp || match.date).trim();
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) {
    when = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  return (
    <div className="grid lg:grid-cols-[1fr_240px_1fr] gap-4 items-start">
      <div>
        <div className="text-[12px] text-[#8a8a8a] mb-2">Players</div>
        <div className="space-y-1.5">
          {teamA.map((p) => (
            <PlayerCard key={p.playerId} player={p} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg bg-[#1c1c1c] border border-white/[0.06] p-3">
          <div className="text-[11px] text-[#8a8a8a] mb-1">Server</div>
          <div className="text-sm font-semibold text-white">{match.region || "Unknown"}</div>
        </div>
        <div className="rounded-lg bg-[#1c1c1c] border border-white/[0.06] p-3 text-center">
          <div className="text-[11px] text-[#8a8a8a] mb-2 flex items-center justify-center gap-1">
            Map
          </div>
          <MapThumb map={match.map} className="w-full h-[72px] mx-auto" />
          <div className="text-sm font-bold text-white mt-2">{match.map}</div>
        </div>
        <Link
          href="/queue"
          className="flex items-center justify-center h-10 rounded-md bg-[#ff5500] text-white text-[12px] font-black uppercase tracking-wide hover:brightness-110"
        >
          Back to matchmaking
        </Link>
        <div className="text-center text-[11px] text-[#6a6a6a] flex items-center justify-center gap-1.5">
          <Calendar className="w-3 h-3" /> {when}
        </div>
      </div>

      <div>
        <div className="text-[12px] text-[#8a8a8a] mb-2 lg:text-right">Players</div>
        <div className="space-y-1.5">
          {teamB.map((p) => (
            <PlayerCard key={p.playerId} player={p} align="right" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Num({
  value,
  color,
  className,
  glow,
}: {
  value: string | number;
  color?: string;
  className?: string;
  glow?: boolean;
}) {
  return (
    <span
      className={cn("tabular-nums", className)}
      style={
        color
          ? {
              color,
              textShadow: glow ? "0 0 14px rgba(255, 196, 77, 0.7)" : undefined,
            }
          : undefined
      }
    >
      {value}
    </span>
  );
}

function StatsTable({
  title,
  players,
  won,
  selectedId,
  onSelect,
}: {
  title: string;
  players: MatchPlayerStats[];
  won: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden mb-3">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161616]">
        <span className="text-sm font-bold text-white">{title}</span>
        <span
          className={cn(
            "text-[10px] font-black uppercase tracking-wide",
            won ? "text-[#2ecc71]" : "text-[#e74c3c]"
          )}
        >
          {won ? "Winner" : "Defeated"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[#6a6a6a] text-[10px] uppercase tracking-wide border-b border-white/[0.06]">
              <th className="text-left font-semibold px-3 py-2">Player</th>
              <th className="font-semibold px-2 py-2">Rank</th>
              <th className="font-semibold px-2 py-2">Elo</th>
              <th className="font-semibold px-2 py-2 cursor-help" title={STAT_ESTIMATE_HINT}>
                Rating
              </th>
              <th className="font-semibold px-2 py-2 cursor-help" title={STAT_ESTIMATE_HINT}>
                Swing
              </th>
              <th className="font-semibold px-2 py-2">K</th>
              <th className="font-semibold px-2 py-2">D</th>
              <th className="font-semibold px-2 py-2">A</th>
              <th className="font-semibold px-2 py-2">Score</th>
              <th className="font-semibold px-2 py-2">K/D</th>
              <th className="font-semibold px-2 py-2">K/R</th>
              <th className="font-semibold px-2 py-2">HS%</th>
              <th className="font-semibold px-2 py-2">MVPs</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const rating = p.rating ?? 0;
              const swing = p.swing ?? 0;
              const selected = p.playerId === selectedId;
              return (
                <tr
                  key={p.playerId}
                  onClick={() => onSelect(p.playerId)}
                  className={cn(
                    "border-b border-white/[0.05] cursor-pointer text-center",
                    selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                    p.mvp && "bg-[#ff5500]/5"
                  )}
                >
                  <td className="text-left px-3 py-2">
                    <Link
                      href={`/profile?player=${encodeURIComponent(p.username)}`}
                      className="flex items-center gap-2 hover:text-[#ff5500]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Avatar className="w-6 h-6">
                        {p.avatarUrl ? <AvatarImage src={p.avatarUrl} /> : null}
                        <AvatarFallback className="bg-[#2a2a2a] text-[9px] font-bold">
                          {initials(p.username)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-white font-semibold truncate max-w-[140px]">
                        {p.username}
                      </span>
                      {p.mvp && <Star className="w-3 h-3 text-[#ff5500] fill-[#ff5500] shrink-0" />}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <RankBadge rank={p.rank} size="sm" showGlow={false} className="!w-5 !h-5 mx-auto" />
                  </td>
                  <td className="px-2 py-2 font-bold">
                    <Num
                      value={formatSigned(p.eloChange ?? 0)}
                      color={eloChangeColor(p.eloChange ?? 0)}
                    />
                  </td>
                  <td className="px-2 py-2 font-bold">
                    <Num value={rating.toFixed(2)} color={ratingColor(rating)} />
                  </td>
                  <td className="px-2 py-2 font-semibold">
                    <Num
                      value={`${formatSigned(swing, 2)}%`}
                      color={swingColor(swing)}
                      glow={swing >= SWING_GREAT}
                    />
                  </td>
                  <td className="px-2 py-2 text-white">{p.kills}</td>
                  <td className="px-2 py-2 text-[#e74c3c]">{p.deaths}</td>
                  <td className="px-2 py-2 text-white">{p.assists}</td>
                  <td className="px-2 py-2 text-white">{p.score}</td>
                  <td className="px-2 py-2 text-white">{p.kdr.toFixed(2)}</td>
                  <td className="px-2 py-2 text-white">{p.kpr != null ? p.kpr.toFixed(2) : "—"}</td>
                  <td className="px-2 py-2 text-white">{(p.headshotPercent || 0).toFixed(1)}</td>
                  <td className="px-2 py-2 text-white">{p.mvps ?? (p.mvp ? 1 : 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stats({ match }: { match: MatchDetail }) {
  const teamA = useMemo(
    () => match.players.filter((p) => p.team === "A").sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
    [match.players]
  );
  const teamB = useMemo(
    () => match.players.filter((p) => p.team === "B").sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
    [match.players]
  );
  const mvp = match.players.find((p) => p.mvp) ?? teamA[0] ?? match.players[0];
  const [selectedId, setSelectedId] = useState(mvp?.playerId ?? "");
  const [sort, setSort] = useState<"team" | "players">("team");
  const selected = match.players.find((p) => p.playerId === selectedId) ?? mvp;

  const mostKills = [...match.players].sort((a, b) => b.kills - a.kills)[0];
  const mostScore = [...match.players].sort((a, b) => b.score - a.score)[0];
  const mostMvps = [...match.players].sort((a, b) => (b.mvps ?? 0) - (a.mvps ?? 0))[0];
  const bestRating = [...match.players].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

  const aWon = match.teamAScore > match.teamBScore || match.winner === "A";
  const flat = useMemo(
    () => [...match.players].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
    [match.players]
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {match.players.map((p) => (
          <button
            key={p.playerId}
            type="button"
            onClick={() => setSelectedId(p.playerId)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 shrink-0",
              p.playerId === selectedId
                ? "border-[#ff5500]/70 bg-[#24180f]"
                : "border-white/[0.06] bg-[#1c1c1c] hover:border-white/15"
            )}
          >
            <Avatar className="w-6 h-6">
              {p.avatarUrl ? <AvatarImage src={p.avatarUrl} /> : null}
              <AvatarFallback className="bg-[#2a2a2a] text-[9px]">{initials(p.username)}</AvatarFallback>
            </Avatar>
            <span className="text-[12px] font-semibold text-white max-w-[90px] truncate">
              {p.username}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="grid lg:grid-cols-[minmax(260px,340px)_1fr] gap-4">
          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <div className="flex items-center gap-3 mb-4">
              <Avatar className="w-14 h-14">
                {selected.avatarUrl ? <AvatarImage src={selected.avatarUrl} /> : null}
                <AvatarFallback className="bg-[#2a2a2a] font-bold">
                  {initials(selected.username)}
                </AvatarFallback>
              </Avatar>
              <div>
                <Link
                  href={`/profile?player=${encodeURIComponent(selected.username)}`}
                  className="text-base font-bold text-white hover:text-[#ff5500]"
                >
                  {selected.username}
                </Link>
                {selected.mvp && (
                  <div className="text-[11px] font-black text-[#ff5500] uppercase tracking-wide mt-0.5">
                    ★ MVP
                  </div>
                )}
              </div>
            </div>
            <div
              className="text-4xl font-black tabular-nums cursor-help"
              style={{ color: ratingColor(selected.rating ?? 0) }}
              title={STAT_ESTIMATE_HINT}
            >
              {(selected.rating ?? 0).toFixed(2)}
            </div>
            <div className="text-[12px] text-[#8a8a8a] mb-4 cursor-help" title={STAT_ESTIMATE_HINT}>
              Rating
            </div>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <div className="text-[#8a8a8a] text-[11px]">Elo</div>
                <div
                  className="font-bold tabular-nums"
                  style={{ color: eloChangeColor(selected.eloChange ?? 0) }}
                >
                  {formatSigned(selected.eloChange ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-[#8a8a8a] text-[11px] cursor-help" title={STAT_ESTIMATE_HINT}>
                  Swing
                </div>
                <div
                  className="font-bold tabular-nums"
                  style={{
                    color: swingColor(selected.swing ?? 0),
                    textShadow:
                      (selected.swing ?? 0) >= SWING_GREAT
                        ? "0 0 14px rgba(255, 196, 77, 0.7)"
                        : undefined,
                  }}
                >
                  {formatSigned(selected.swing ?? 0, 2)}%
                </div>
              </div>
              <div>
                <div className="text-[#8a8a8a] text-[11px]">Score</div>
                <div className="font-bold text-white tabular-nums">{selected.score}</div>
              </div>
              <div>
                <div className="text-[#8a8a8a] text-[11px]">K/D/A</div>
                <div className="font-bold text-white tabular-nums">
                  {selected.kills}/{selected.deaths}/{selected.assists}
                </div>
              </div>
              <div>
                <div className="text-[#8a8a8a] text-[11px]">Headshot %</div>
                <div className="font-bold text-white tabular-nums">
                  {(selected.headshotPercent || 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { label: "Most kills", player: mostKills, value: mostKills?.kills },
              { label: "Most score", player: mostScore, value: mostScore?.score },
              { label: "Most MVPs", player: mostMvps, value: mostMvps?.mvps ?? 0 },
              { label: "Best rating", player: bestRating, value: (bestRating?.rating ?? 0).toFixed(2) },
            ].map((row) => (
              <button
                key={row.label}
                type="button"
                onClick={() => row.player && setSelectedId(row.player.playerId)}
                className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#1c1c1c] px-3 py-3 text-left hover:border-white/15"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="w-8 h-8">
                    {row.player?.avatarUrl ? <AvatarImage src={row.player.avatarUrl} /> : null}
                    <AvatarFallback className="bg-[#2a2a2a] text-[10px]">
                      {initials(row.player?.username || "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-[11px] text-[#8a8a8a]">{row.label}</div>
                    <div className="text-sm font-semibold text-white truncate">
                      {row.player?.username}
                    </div>
                  </div>
                </div>
                <div className="text-lg font-black text-white tabular-nums shrink-0 ml-2">
                  {row.value}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setSort("team")}
          className={cn(
            "h-7 px-3 rounded text-[11px] font-semibold",
            sort === "team" ? "bg-[#ff5500] text-white" : "bg-[#1c1c1c] text-[#8a8a8a]"
          )}
        >
          Sort by team
        </button>
        <button
          type="button"
          onClick={() => setSort("players")}
          className={cn(
            "h-7 px-3 rounded text-[11px] font-semibold",
            sort === "players" ? "bg-[#ff5500] text-white" : "bg-[#1c1c1c] text-[#8a8a8a]"
          )}
        >
          Sort by players
        </button>
      </div>

      {sort === "team" ? (
        <>
          <StatsTable
            title={match.teamAName}
            players={teamA}
            won={aWon}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <StatsTable
            title={match.teamBName}
            players={teamB}
            won={!aWon}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </>
      ) : (
        <StatsTable
          title="All players"
          players={flat}
          won={aWon}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}

export function MatchRoomResult({ match }: { match: MatchDetail }) {
  const [tab, setTab] = useState<"overview" | "stats">("overview");
  const aWon = match.teamAScore > match.teamBScore;
  const bWon = match.teamBScore > match.teamAScore;
  const mode = match.modeLabel || MATCH_MODE_LABEL;

  let when = match.date;
  const raw = (match.timestamp || match.date).trim();
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) {
    when = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-white">Matchroom</h1>
        <div className="flex items-center gap-5">
          {(["overview", "stats"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`text-[12px] font-bold uppercase tracking-wide pb-1 border-b-2 ${
                tab === t
                  ? "text-[#ff5500] border-[#ff5500]"
                  : "text-[#8a8a8a] border-transparent hover:text-white"
              }`}
            >
              {t === "overview" ? "Overview" : (
                <span className="inline-flex items-center gap-1">
                  Stats <span className="text-[9px] font-black bg-[#ff5500] text-white px-1 rounded-sm">NEW</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-white/[0.06] mb-5">
        <div className="absolute inset-0">
          <MapThumb map={match.map} className="w-full h-full rounded-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/70 to-[#111]" />
        </div>
        <div className="relative z-10 px-5 pt-4 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#c8c8c8] mb-6">
            <span className="inline-flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5" />
              Matchmaking / {match.region} / Standard {mode}
            </span>
            <span className="inline-flex items-center gap-2">
              <span>{match.map}</span>
              <span className="text-[#8a8a8a]">{when}</span>
            </span>
          </div>

          <div className="flex items-center justify-center gap-4 sm:gap-8">
            <div className="flex-1 flex items-center justify-end gap-3 min-w-0">
              <div className="text-right min-w-0">
                <div className="text-lg sm:text-xl font-bold text-white truncate">{match.teamAName}</div>
                {aWon && (
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#2ecc71]">Winner</div>
                )}
              </div>
              <Avatar className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 ring-2 ring-white/10">
                {match.teamAAvatar ? <AvatarImage src={match.teamAAvatar} /> : null}
                <AvatarFallback className="bg-[#2a2a2a] font-bold">
                  {initials(match.teamAName.replace(/^team_/, ""))}
                </AvatarFallback>
              </Avatar>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <span className={`text-4xl sm:text-5xl font-black tabular-nums ${aWon ? "text-white" : "text-[#8a8a8a]"}`}>
                {match.teamAScore}
              </span>
              <span className="text-sm font-bold text-[#8a8a8a]">vs</span>
              <span className={`text-4xl sm:text-5xl font-black tabular-nums ${bWon ? "text-white" : "text-[#8a8a8a]"}`}>
                {match.teamBScore}
              </span>
            </div>

            <div className="flex-1 flex items-center justify-start gap-3 min-w-0">
              <Avatar className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 ring-2 ring-white/10">
                {match.teamBAvatar ? <AvatarImage src={match.teamBAvatar} /> : null}
                <AvatarFallback className="bg-[#2a2a2a] font-bold">
                  {initials(match.teamBName.replace(/^team_/, ""))}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-bold text-white truncate">{match.teamBName}</div>
                {bWon && (
                  <div className="text-[10px] font-black uppercase tracking-wide text-[#2ecc71]">Winner</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {tab === "overview" ? <Overview match={match} /> : <Stats match={match} />}
    </div>
  );
}
