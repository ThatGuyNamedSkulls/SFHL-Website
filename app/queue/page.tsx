"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { LobbySlots, LobbyMember } from "@/components/lobby-slots";
import { RankTierLetter } from "@/types";
import {
  AlertCircle,
  Users,
  Loader2,
  Swords,
  ShieldCheck,
  Activity,
  Medal,
  Star,
  Server,
  Zap,
  UserPlus,
  Gem,
  Lock,
} from "lucide-react";
import { usePlayRegion, setQueueLocked } from "@/components/use-play-region";
import { QUEUE_REGIONS, regionQueueLabel, isQueueRegion } from "@/lib/regions";
import { MATCH_TEAM_SIZE } from "@/lib/match-mode";
import {
  PRO_QUEUE_ENABLED,
  QUEUE_MODE_PRO,
  QUEUE_MODE_SUPER,
  SUPER_PARTY_MAX,
  SUPER_ELO_RANGE,
  parseQueueMode,
  queueModeLabel,
} from "@/lib/queue-modes";
import { useSession } from "@/components/session-provider";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { LEVELS, levelOf } from "@/lib/league-find-rules";

interface WebQueueEntry {
  id: number;
  discord_id: string;
  discord_username: string;
  player_name: string | null;
  joined_at: string;
  queue_mode?: string | null;
  clubTag?: string | null;
}

interface PlayerInfo {
  rank: RankTierLetter;
  elo: number;
  peakElo: number;
  wins: number;
  avatarUrl: string;
  country: string | null;
  card: string | null;
  frame: string | null;
  placementDone: boolean;
  placementGamesPlayed: number;
  mmAccess: boolean;
}

// Minimal shape of the party API response (avoids importing lib/parties, which
// pulls in server-only deps).
interface PartyMemberLite {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  rank: string;
  elo: number;
  country: string | null;
  card?: string | null;
  frame?: string | null;
  verified?: boolean | null;
  canQueue?: boolean;
  mmAccess?: boolean | null;
  clubTag?: string | null;
}
interface PartyLite {
  id: string;
  leaderId: string;
  members: PartyMemberLite[];
}

interface MatchTypeFeature {
  icon: typeof Users;
  text: string;
  star?: boolean;
}

/** FACEIT-style match-type cards. */
const MATCH_TYPES: {
  id: string;
  label: string;
  green?: boolean;
  /** Pro Matchmaking card (purple; shown to everyone, locked below S2). */
  pro?: boolean;
  icon: typeof Swords;
  features: MatchTypeFeature[];
}[] = [
  {
    id: "standard",
    label: "Standard Match",
    icon: Swords,
    features: [
      { icon: Users, text: "Party of 5" },
      { icon: ShieldCheck, text: "Verified Matching", star: true },
      { icon: Activity, text: "No Elo restrictions" },
      { icon: Medal, text: "5v5 Strike Force" },
    ],
  },
  {
    id: "super",
    label: "Super Match",
    green: true,
    icon: Zap,
    features: [
      { icon: Users, text: "Solo, duo, trio" },
      { icon: ShieldCheck, text: "Verified Matching", star: true },
      { icon: Activity, text: `${SUPER_ELO_RANGE} Elo range` },
      { icon: Medal, text: "5v5 Strike Force" },
    ],
  },
  {
    id: "pro",
    label: "Pro Matchmaking",
    pro: true,
    icon: Gem,
    features: [
      { icon: ShieldCheck, text: "S2+ only (1900+ Elo)", star: true },
      { icon: Activity, text: "Separate Pro Elo & leaderboard" },
    ],
  },
];

/** Placement games required before a rank is assigned (matches the bot). */
const PLACEMENT_GAMES = 3;

function isUnrankedRank(rank: string | undefined | null): boolean {
  const r = (rank || "").toUpperCase();
  return !r || r === "UNRANKED" || r.includes("UNRANKED") || r.includes("[?]");
}

export default function QueuePage() {
  const { session, discordInvite: sessionInvite } = useSession();
  const [discordInvite, setDiscordInvite] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [party, setParty] = useState<PartyLite | null>(null);
  const [queue, setQueue] = useState<WebQueueEntry[]>([]);
  // Live queue format (5v5).
  const [teamSize, setTeamSize] = useState(MATCH_TEAM_SIZE);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchType, setMatchType] = useState("standard");
  const [playTab, setPlayTab] = useState<"type" | "servers">("type");
  const [queueOpen, setQueueOpen] = useState(false);
  const [openRegions, setOpenRegions] = useState<string[]>([]);
  const [openModes, setOpenModes] = useState<Record<string, string[]>>({});
  // Pro Matchmaking is shown to everyone but only S2+ players can pick it.
  const [proEligible, setProEligible] = useState(false);
  const [queuedSpot, setQueuedSpot] = useState<{ region: string; mode: string } | null>(null);
  // Open substitute slots (live matches missing a player), for the CTA strip.
  const [subCount, setSubCount] = useState(0);
  const { region, setRegion } = usePlayRegion();
  // While a join/leave POST is in flight (and briefly after), ignore the 5s
  // poll's queue snapshot so a poll that started before the action can't land
  // afterwards and revert the button's optimistic result.
  const actionInFlight = useRef(false);

  useEffect(() => {
    if (sessionInvite) setDiscordInvite(sessionInvite);
  }, [sessionInvite]);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const [q, p, sub] = await Promise.all([
          apiGetJson<{
            queue?: WebQueueEntry[];
            teamSize?: number;
            openRegions?: string[];
            region?: string;
            openModes?: Record<string, string[]>;
            me?: { region?: string; mode?: string } | null;
            proEligible?: boolean;
          }>(`/api/queue?region=${encodeURIComponent(region)}&_=${Date.now()}`, { force: true }),
          apiGetJson<{ parties?: PartyLite[] }>("/api/parties?mine=1"),
          apiGetJson<{ count?: number }>("/api/subs"),
        ]);
        const qData = q.json;
        if (!actionInFlight.current) setQueue(qData.queue || []);
        setTeamSize(qData.teamSize || MATCH_TEAM_SIZE);
        const regions = Array.isArray(qData.openRegions)
          ? (qData.openRegions as string[])
          : typeof qData.region === "string"
            ? [qData.region]
            : [];
        setOpenRegions(regions);
        setQueueOpen(regions.length > 0);
        setProEligible(qData.proEligible === true);
        if (qData.openModes && typeof qData.openModes === "object") {
          setOpenModes(qData.openModes as Record<string, string[]>);
        }
        setQueuedSpot(
          qData.me && typeof qData.me.region === "string"
            ? { region: qData.me.region, mode: parseQueueMode(qData.me.mode) }
            : null
        );
        const me = session;
        const mine = me
          ? (p.json.parties as PartyLite[] | undefined)?.find((party) =>
              party.members.some((m) => m.discordId === me.discordId)
            )
          : null;
        setParty(mine ?? null);
        setSubCount(Number(sub.json?.count ?? 0));
        setLoading(false);
      } catch (err) {
        console.error("Queue poll error:", err);
        setLoading(false);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [region, session?.discordId]);

  // Fetch the linked player's rank/elo for the lobby slot + season display.
  useEffect(() => {
    if (session?.playerName) {
      fetch(`/api/players/${encodeURIComponent(session.playerName)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setPlayer({
          rank: d.rank,
          elo: d.elo,
          peakElo: d.peakElo ?? d.elo,
          wins: d.stats?.wins ?? 0,
          avatarUrl: d.avatarUrl,
          country: d.country,
          card: d.cosmetics?.card?.asset ?? null,
          frame: d.cosmetics?.frame?.asset ?? null,
          placementDone: !!d.placementDone,
          placementGamesPlayed: d.placementGamesPlayed ?? 0,
          mmAccess: !!d.mmAccess,
        }))
        .catch(() => { });
    }
  }, [session?.playerName]);

  const inQueue =
    !!queuedSpot ||
    !!(session && queue.some((q) => String(q.discord_id) === String(session.discordId)));
  const selectionLocked = inQueue || actionLoading;
  const visibleQueue = queue.filter((e) => parseQueueMode(e.queue_mode) === matchType);
  const canQueue =
    !!session?.inGuild && session?.verified !== false && !!session?.playerName;

  useEffect(() => {
    setQueueLocked(inQueue);
  }, [inQueue]);

  useEffect(() => {
    if (!queuedSpot) return;
    if (isQueueRegion(queuedSpot.region) && queuedSpot.region !== region) {
      setRegion(queuedSpot.region, { force: true });
    }
    if (queuedSpot.mode !== matchType) setMatchType(queuedSpot.mode);
  }, [queuedSpot, region, matchType, setRegion]);

  const handleJoin = async () => {
    setActionLoading(true);
    actionInFlight.current = true;
    setError(null);
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, mode: matchType }),
      });
      const data = await res.json();
      invalidateClientApi();
      if (!res.ok) setError(data.error || "Failed to join queue");
      else {
        setQueue(data.queue);
        setQueuedSpot({ region, mode: matchType });
      }
    } catch {
      setError("An error occurred");
    } finally {
      setActionLoading(false);
      actionInFlight.current = false;
    }
  };

  const handleLeave = async () => {
    setActionLoading(true);
    actionInFlight.current = true;
    setError(null);
    try {
      const res = await fetch(`/api/queue?region=${encodeURIComponent(region)}`, { method: "DELETE" });
      const data = await res.json();
      invalidateClientApi();
      if (!res.ok) setError(data.error || "Failed to leave queue");
      else {
        setQueue(data.queue);
        setQueuedSpot(null);
      }
    } catch {
      setError("An error occurred");
    } finally {
      setActionLoading(false);
      actionInFlight.current = false;
    }
  };

  // Build the lobby. If the user is in a party, show the whole party (leader
  // first); otherwise just show the logged-in user. Your own slot prefers your
  // freshly-fetched rank/avatar over the (possibly stale) party snapshot.
  const you: LobbyMember | null = session
    ? {
      username: session.playerName || session.username,
      avatar: player?.avatarUrl || session.avatar,
      rank: player?.rank,
      elo: player?.placementDone ? player.elo : null,
      leader: true,
      country: player?.country ?? null,
      card: player?.card ?? null,
      frame: player?.frame ?? null,
      self: true,
      verified: session.verified !== false && session.inGuild,
      mmAccess: !!(player?.mmAccess || session.mmAccess),
      canQueue,
      clubTag: session.clubTag ?? null,
    }
    : null;

  let lobbyMembers: LobbyMember[];
  if (party && session) {
    const ordered = [...party.members].sort((a, b) =>
      a.discordId === party.leaderId ? -1 : b.discordId === party.leaderId ? 1 : 0
    );
    lobbyMembers = ordered.map((m) => {
      const isMe = m.discordId === session.discordId;
      return {
        username: m.playerName || m.username,
        avatar: (isMe ? player?.avatarUrl || session.avatar : m.avatar) ?? null,
        rank: ((isMe ? player?.rank : undefined) ?? m.rank) as RankTierLetter,
        elo: isMe ? (player?.placementDone ? player.elo : null) : m.elo,
        leader: m.discordId === party.leaderId,
        country: (isMe ? player?.country ?? m.country : m.country) ?? null,
        card: (isMe ? player?.card ?? m.card : m.card) ?? null,
        frame: (isMe ? player?.frame ?? m.frame : m.frame) ?? null,
        self: isMe,
        verified: isMe ? session.verified !== false && session.inGuild : m.verified ?? null,
        mmAccess: isMe ? !!(player?.mmAccess || session.mmAccess) : m.mmAccess ?? null,
        canQueue: isMe ? canQueue : m.canQueue,
        clubTag: isMe ? session.clubTag ?? m.clubTag : m.clubTag,
      };
    });
  } else {
    lobbyMembers = you ? [you] : [];
  }

  // One ineligible party member blocks the whole party from queueing.
  const partyBlocked = lobbyMembers.some((m) => m.canQueue === false);
  const selfPlacing = !!player && !player.placementDone;
  const partyStillPlacing = lobbyMembers.some((m) =>
    m.self ? selfPlacing : isUnrankedRank(m.rank)
  );
  const superPlacementBlocked = selfPlacing || partyStillPlacing;

  const modeLabel = `${teamSize}v${teamSize}`;
  const regionOk = openRegions.includes(region);
  const modesForRegion = openModes[region] ?? (queueOpen && regionOk ? ["standard", "super"] : []);
  const modeOk = modesForRegion.includes(matchType);
  const superPartyTooBig = matchType === QUEUE_MODE_SUPER && lobbyMembers.length > SUPER_PARTY_MAX;
  const superBlockedHere = matchType === QUEUE_MODE_SUPER && superPlacementBlocked;
  const isPartyCaptain = !party || !session || party.leaderId === session.discordId;
  const findDisabled =
    actionLoading || loading || ((!canQueue || partyBlocked || !regionOk || !modeOk || superPartyTooBig || superBlockedHere || !isPartyCaptain) && !inQueue);
  const findHint = !session
    ? null
    : !canQueue
      ? null
      : partyBlocked
        ? null
        : !isPartyCaptain
          ? "Only the party captain can start the queue."
        : superPartyTooBig
          ? `Super Match only allows solo, duo, or trio. Leave extra party members first.`
          : superBlockedHere
            ? "Super Match is for ranked players. Everyone in the party must finish placements first."
          : !queueOpen
          ? "No Discord queue is open. Match Staff need to run /queue with a region first."
          : !regionOk
            ? `Open now: ${openRegions.join(", ")}. Switch to one of those regions in Servers to find a match.`
            : !modeOk
              ? `${queueModeLabel(matchType)} is closed in ${region}.`
            : null;

  // Header banner state: placement progress until ranked, skill level after.
  const placed = !!player?.placementDone;
  const placementPlayed = Math.min(player?.placementGamesPlayed ?? 0, PLACEMENT_GAMES);
  const level = placed && player && player.elo > 0 ? levelOf(player.elo) : 0;
  const wins = player?.wins ?? 0;
  const regionLive = openRegions.includes(region);
  const panel = "rounded-xl border border-white/[0.08] bg-[#121212]";
  const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50";

  return (
    <div className="hl-page space-y-5">
      {/* Queue region pill — follows the server you picked in Servers */}
      <div className="flex justify-center">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${
            regionLive ? "border-[#ff5500]/50 bg-[#ff5500]/10 text-[#ff5500]" : "border-white/15 bg-white/[0.05] text-white/70"
          }`}
        >
          {regionLive ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5500]" /> : null}
          {regionQueueLabel(region, teamSize)}
        </span>
      </div>

      {/* Season / skill level (FACEIT-style) */}
      <section className={`${panel} relative overflow-hidden p-4 md:p-6`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_50%,rgba(255,85,0,0.16),transparent_45%)]"
        />
        <div className="relative flex flex-wrap items-center gap-5">
          <RankBadge rank={placed && player ? player.rank : "UNRANKED"} size="lg" />
          <div className="min-w-0">
            <div className={label}>Season 1 · Skill level</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="text-3xl font-black leading-tight text-white">{placed && player ? player.rank : "Unranked"}</span>
              {level ? <span className="text-sm font-black text-[#ff5500]">Level {level}</span> : null}
            </div>
            {placed && player ? (
              <>
                <div className="mt-2 flex items-center gap-1" aria-label={`Level ${level} of ${LEVELS.length}`}>
                  {LEVELS.map((l) => (
                    <span key={l.level} className={`h-1.5 w-6 rounded-full ${l.level <= level ? "bg-[#ff5500]" : "bg-white/[0.1]"}`} />
                  ))}
                </div>
                <div className="mt-1.5 text-[11px] text-white/55">
                  Elo <b className="stat-number text-white">{player.elo.toLocaleString("en-US")}</b> · Peak{" "}
                  <b className="stat-number text-white">{player.peakElo.toLocaleString("en-US")}</b>
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-1">
                  {Array.from({ length: PLACEMENT_GAMES }).map((_, i) => (
                    <span key={i} className={`h-1.5 w-8 rounded-full ${i < placementPlayed ? "bg-[#ff5500]" : "bg-white/[0.1]"}`} />
                  ))}
                </div>
                <div className="mt-1.5 text-[11px] text-white/55">
                  <b className="text-[#ff5500]">{PLACEMENT_GAMES - placementPlayed} matches left</b> to get your skill level
                </div>
              </>
            )}
          </div>

          {/* Prestige path */}
          <div className="flex w-full items-center gap-4 rounded-xl border border-white/[0.08] bg-black/30 p-4 sm:ml-auto sm:w-auto sm:min-w-[300px]">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#ff5500]">Season 1 prestige path</div>
              <div className="mt-1 text-sm font-black text-white">Get 20 wins</div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-[#ff5500]" style={{ width: `${Math.min(100, (wins / 20) * 100)}%` }} />
                </div>
                <span className="text-xs text-white/55">
                  <b className="stat-number text-white">{Math.min(wins, 20)}</b>/20
                </span>
              </div>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-4 border-[#ff5500]/60 text-sm font-black text-[#ff5500]">
              S1
            </div>
          </div>
        </div>
      </section>

      {/* Party + Find match */}
      <section className={`${panel} p-4 md:p-6`}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-black text-white">Your party</h2>
            <span className="text-xs tabular-nums text-white/50">
              {lobbyMembers.length}/{teamSize}
            </span>
          </div>
          {inQueue ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hl-green/35 bg-hl-green/10 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-hl-green">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </span>
          ) : (
            <span className="text-[11px] font-bold text-white/45">{queueModeLabel(matchType)} · {modeLabel}</span>
          )}
        </div>

        <div className="py-3">
          <LobbySlots members={lobbyMembers} size={teamSize} findPartiesHref="/party-finder" />
        </div>

        {/* Warning banner */}
        {session && !canQueue && (
          <Notice tone="warn">
            {!session.inGuild ? (
              <>
                You must be in the HyperLeague Discord server to queue.{" "}
                {discordInvite ? (
                  <a href={discordInvite} target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-white">
                    Join the server
                  </a>
                ) : null}
              </>
            ) : session.verified === false ? (
              "You have to verify with Bloxlink in the HyperLeague Discord before you can queue."
            ) : (
              "Your Discord account is not linked to a HyperLeague player. Join the Discord server and verify with Bloxlink first."
            )}
          </Notice>
        )}
        {session && canQueue && partyBlocked && (
          <Notice tone="warn">
            There are requirements one or more party members don&apos;t meet — check the warning icon on their card.
          </Notice>
        )}
        {findHint && <Notice tone="warn">{findHint}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        {/* Find match button */}
        <div className="mt-6 flex justify-center">
          {!session ? (
            <Link
              href="/login"
              className="find-match-btn header-caps inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-4 text-lg font-black text-hl-base sm:w-auto sm:px-14"
            >
              Log in to play
            </Link>
          ) : (
            <button
              onClick={inQueue ? handleLeave : handleJoin}
              disabled={findDisabled}
              className={`header-caps inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-4 text-lg font-black transition-all sm:w-auto sm:px-14 ${
                inQueue ? "border border-hl-red/40 bg-hl-red/10 text-hl-red hover:bg-hl-red/20" : "find-match-btn text-hl-base"
              } ${findDisabled && "cursor-not-allowed opacity-50"}`}
            >
              {actionLoading ? "Processing…" : inQueue ? "Cancel" : "Find match"}
            </button>
          )}
        </div>
      </section>

      {/* Substitute CTA — live matches missing a player. Hidden while queueing,
          since you can't be waiting for a match and joining one at once. */}
      {!inQueue && (
        <section className={`${panel} flex flex-wrap items-center gap-4 p-4 sm:p-5 ${subCount > 0 ? "border-[#ff5500]/40" : ""}`}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#ff5500]/15 text-[#ff5500]">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-black text-white">Only have time for a quick one? Join a match as a substitute!</div>
            <div className="mt-0.5 text-sm text-white/55">
              {subCount > 0
                ? `${subCount === 1 ? "1 live match needs" : `${subCount} live matches need`} a player right now — you earn Elo for the rounds you play.`
                : "No match needs a player right now. Slots open when someone leaves mid-game, and they fill fast."}
            </div>
          </div>
          <Link
            href="/subs"
            className={`header-caps inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-black sm:w-auto ${
              subCount > 0 ? "find-match-btn text-hl-base" : "border border-white/15 bg-white/[0.04] text-white hover:border-white/35"
            }`}
          >
            {subCount > 0 && <Zap className="h-4 w-4" />} Join now
          </Link>
        </section>
      )}

      {/* Match type / Servers (FACEIT-style). Maps stay post-match veto. */}
      <section>
        <nav aria-label="Queue options" className="mb-4 flex gap-6 overflow-x-auto border-b border-white/[0.08]">
          {(
            [
              ["type", "Match type", Swords],
              ["servers", "Servers", Server],
            ] as const
          ).map(([key, text, Icon]) => {
            const on = playTab === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setPlayTab(key)}
                className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm font-black uppercase tracking-wide ${
                  on ? "border-[#ff5500] text-white" : "border-transparent text-white/55 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" /> {text}
              </button>
            );
          })}
        </nav>
        {playTab === "type" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {/* Pro Matchmaking is switched off: Pro Elo comes from league matches now. */}
            {MATCH_TYPES.filter((mt) => PRO_QUEUE_ENABLED || mt.id !== QUEUE_MODE_PRO).map((mt) => {
              const active = matchType === mt.id;
              const TypeIcon = mt.icon;
              const superLocked = mt.id === QUEUE_MODE_SUPER && superPlacementBlocked;
              // Everyone sees Pro; below S2 it stays locked (the API refuses too).
              const proLocked = mt.id === QUEUE_MODE_PRO && !proEligible && matchType !== QUEUE_MODE_PRO;
              const typeDisabled = (selectionLocked && mt.id !== matchType) || superLocked || proLocked;
              const accent = mt.green ? "text-hl-green" : mt.pro ? "text-[#c084fc]" : "text-white";
              const open = modesForRegion.includes(mt.id);
              return (
                <button
                  key={mt.id}
                  type="button"
                  disabled={typeDisabled}
                  aria-pressed={active}
                  title={proLocked ? "Reach S2 (1900 Elo) to unlock Pro Matchmaking" : undefined}
                  onClick={() => {
                    if (typeDisabled) return;
                    setMatchType(mt.id);
                  }}
                  className={`relative h-full w-full overflow-hidden rounded-xl border p-4 text-left ${
                    active ? "border-[#ff5500] bg-[#ff5500]/[0.06]" : "border-white/[0.08] bg-[#121212] hover:border-white/25"
                  } ${typeDisabled ? "cursor-not-allowed opacity-40 hover:border-white/[0.08]" : "transition-colors"}`}
                >
                  {mt.green && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-hl-green/10 to-transparent" />
                  )}
                  {mt.pro && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#a855f7]/15 to-transparent" />
                  )}
                  <div className="relative mb-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <TypeIcon className={`h-4 w-4 shrink-0 ${accent}`} />
                      <span className={`truncate text-sm font-black ${accent}`}>{mt.label}</span>
                      <span className="shrink-0 text-xs text-white/45">· {modeLabel}</span>
                    </div>
                    {proLocked ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-white/50">
                        <Lock className="h-3.5 w-3.5" /> S2 required
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                          open ? "bg-hl-green/15 text-hl-green" : "bg-white/[0.06] text-white/45"
                        }`}
                      >
                        {open ? "Open" : "Closed"}
                      </span>
                    )}
                  </div>
                  <div className={`relative grid gap-2 ${mt.features.length > 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {mt.features.map(({ icon: FeatIcon, text, star }) => (
                      <div key={text} className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-black/30 px-2 py-2">
                        <FeatIcon className="h-3.5 w-3.5 shrink-0 text-white/50" />
                        <span className="min-w-0 text-[10px] font-semibold leading-tight text-white/85">{text}</span>
                        {star && <Star className="ml-auto h-3 w-3 shrink-0 fill-current text-hl-green" />}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUEUE_REGIONS.map((r) => {
              const selected = region === r.id;
              const thisOpen = openRegions.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={selectionLocked && r.id !== region}
                  onClick={() => {
                    if (selectionLocked) return;
                    setRegion(r.id);
                  }}
                  className={`rounded-xl border p-4 text-left ${
                    selected ? "border-[#ff5500] bg-[#ff5500]/[0.06]" : "border-white/[0.08] bg-[#121212] hover:border-white/25"
                  } ${selectionLocked && r.id !== region ? "cursor-not-allowed opacity-40 hover:border-white/[0.08]" : "transition-colors"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white">{r.label}</span>
                    <span className="text-xs font-bold text-white/45">{r.short}</span>
                  </div>
                  <div className="mt-2 text-[11px]">
                    {thisOpen ? (
                      <span className="inline-flex items-center gap-1.5 font-bold text-hl-green">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hl-green" /> Queue open
                      </span>
                    ) : (
                      <span className="text-white/45">Closed until staff run /queue {r.short}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Web queue list */}
      <section className={`${panel} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-5">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <Users className="h-4 w-4 text-[#ff5500]" /> Players queuing
            <span className="text-white/45">({visibleQueue.length})</span>
          </h3>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#ff5500]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5500]" /> Live
          </span>
        </div>
        {visibleQueue.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-white/50">No one is queuing for {queueModeLabel(matchType)} yet.</div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {visibleQueue.map((entry, idx) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="w-5 text-xs tabular-nums text-white/40">{idx + 1}</span>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-[10px] font-black text-white/70">
                  {(entry.player_name || entry.discord_username).slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 truncate text-sm font-bold text-white">
                  {entry.clubTag ? <span className="text-[#ff5500]">[{entry.clubTag}] </span> : null}
                  {entry.player_name || entry.discord_username}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer stat strip */}
      <div className="border-t border-white/[0.08] pt-4 text-center text-xs text-white/50">
        Players queuing in {region}: <b className="stat-number text-white">{queue.length}</b>
      </div>
    </div>
  );
}

/** An inline notice under the party (hints, warnings, errors). */
function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
        tone === "error" ? "border-hl-red/30 bg-hl-red/10 text-hl-red" : "border-[#ff5500]/30 bg-[#ff5500]/[0.07] text-[#ff8a4d]"
      }`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
