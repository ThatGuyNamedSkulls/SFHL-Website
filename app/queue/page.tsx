"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { LobbySlots, LobbyMember } from "@/components/lobby-slots";
import { RankTierLetter } from "@/types";
import {
  AlertCircle,
  Users,
  Loader2,
  Swords,
  Info,
  ShieldCheck,
  Activity,
  Medal,
  Star,
  Server,
  Zap,
  UserPlus,
  Gem,
} from "lucide-react";
import { usePlayRegion, setQueueLocked } from "@/components/use-play-region";
import { QUEUE_REGIONS, regionQueueLabel, isQueueRegion } from "@/lib/regions";
import { MATCH_TEAM_SIZE } from "@/lib/match-mode";
import {
  QUEUE_MODE_PRO,
  QUEUE_MODE_SUPER,
  SUPER_PARTY_MAX,
  SUPER_ELO_RANGE,
  parseQueueMode,
  queueModeLabel,
} from "@/lib/queue-modes";
import { useSession } from "@/components/session-provider";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { ClubTaggedName } from "@/components/club-identity";

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
  /** Pro Matchmaking card (purple, shown only to S2+ players). */
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
      { icon: Users, text: "Party of 5" },
      { icon: ShieldCheck, text: "S2+ only (1900+ Elo)", star: true },
      { icon: Activity, text: "Own Pro Elo & leaderboard" },
      { icon: Medal, text: "5v5 Strike Force" },
    ],
  },
];

/** Ranked tier ladder for the skill-level segments in the header. */
const TIER_LADDER: RankTierLetter[] = ["D", "C", "B", "A1", "A2", "A3", "S1", "S2", "S3"];

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
  // Pro Matchmaking is only visible to players who can join it (S2+).
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

  // Header banner state: placement progress until ranked, tier ladder after.
  const placed = !!player?.placementDone;
  const placementPlayed = Math.min(player?.placementGamesPlayed ?? 0, PLACEMENT_GAMES);
  const tierIdx = player ? TIER_LADDER.indexOf(player.rank) : -1;
  const wins = player?.wins ?? 0;

  return (
    <div className="hl-page">
      {/* Queue region pill — follows the server you picked in Servers */}
      <div className="flex justify-center mb-5">
        <span className="bg-gold-gradient text-hl-base rounded-full px-4 py-1.5 text-xs font-black header-caps">
          {regionQueueLabel(region, teamSize)}
        </span>
      </div>

      {/* Season / skill-level banner (FACEIT-style) */}
      <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
        <div className="flex flex-wrap items-center gap-5">
          <RankBadge rank={placed && player ? player.rank : "UNRANKED"} size="lg" />
          <div className="min-w-0">
            <span className="inline-block bg-hl-panel-light text-hl-muted rounded-full px-3 py-0.5 text-[11px] font-bold mb-1.5">
              Season 1
            </span>
            <div className="text-3xl font-black text-white leading-tight">
              {placed && player ? player.rank : "Unranked"}
            </div>
            {placed && player ? (
              <>
                <div className="flex items-center gap-1.5 mt-2">
                  {TIER_LADDER.map((t, i) => (
                    <span
                      key={t}
                      className={`w-7 h-1 rounded-full ${i <= tierIdx ? "bg-hl-gold" : "bg-hl-border"}`}
                    />
                  ))}
                </div>
                <div className="text-[11px] text-hl-muted mt-1.5">
                  ELO <b className="text-white stat-number">{player.elo}</b> · Peak{" "}
                  <b className="text-white stat-number">{player.peakElo}</b>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 mt-2">
                  {Array.from({ length: PLACEMENT_GAMES }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-7 h-1 rounded-full ${i < placementPlayed ? "bg-hl-gold" : "bg-hl-border"}`}
                    />
                  ))}
                </div>
                <div className="text-[11px] text-hl-muted mt-1.5">
                  <b className="text-hl-gold">{PLACEMENT_GAMES - placementPlayed} matches left</b> to get your{" "}
                  <span className="text-hl-gold">Skill Level</span>
                </div>
              </>
            )}
          </div>

          {/* Prestige path */}
          <div className="ml-auto flex items-center gap-4 rounded-xl border border-hl-border bg-hl-panel-light/40 p-4 w-full sm:w-auto sm:min-w-[300px]">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] header-caps text-hl-gold">Season 1 Prestige Path</div>
              <div className="text-sm font-bold text-white mt-1">Get 20 wins</div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-hl-base rounded-full">
                  <div
                    className="h-1.5 bg-gold-gradient rounded-full"
                    style={{ width: `${Math.min(100, (wins / 20) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-hl-muted">
                  <b className="text-white stat-number">{Math.min(wins, 20)}</b> /20
                </span>
              </div>
            </div>
            <div className="w-12 h-12 shrink-0 rounded-lg bg-hl-base border border-hl-gold/40 flex items-center justify-center text-hl-gold font-black text-sm">
              S1
            </div>
          </div>
        </div>
      </Card>

      {/* Lobby slots */}
      <Card className="bg-hl-panel border-hl-border p-4 md:p-6 mb-6">
        {inQueue && (
          <div className="flex justify-end mb-3">
            <Badge className="bg-hl-green/15 text-hl-green border-hl-green/30 animate-pulse-glow">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Searching…
            </Badge>
          </div>
        )}

        <div className="py-3">
          <LobbySlots members={lobbyMembers} size={teamSize} findPartiesHref="/party-finder" />
        </div>

        {/* Warning banner */}
        {session && !canQueue && (
          <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>
              {!session.inGuild ? (
                <>
                  You must be in the HyperLeague Discord server to queue.{" "}
                  {discordInvite ? (
                    <a
                      href={discordInvite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-bold hover:text-white"
                    >
                      Join the server
                    </a>
                  ) : null}
                </>
              ) : session.verified === false ? (
                "You have to verify with Bloxlink in the HyperLeague Discord before you can queue."
              ) : (
                "Your Discord account is not linked to a HyperLeague player. Join the Discord server and verify with Bloxlink first."
              )}
            </span>
          </div>
        )}
        {session && canQueue && partyBlocked && (
          <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            There are requirements one or more party members don&apos;t meet — check the warning icon above their card.
          </div>
        )}
        {findHint && (
          <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" /> {findHint}
          </div>
        )}

        {error && (
          <div className="mt-5 p-4 rounded-xl bg-hl-red/10 border border-hl-red/20 text-hl-red flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" /> {error}
          </div>
        )}

        {/* Find match button */}
        <div className="flex justify-center mt-6">
          {!session ? (
            <Link
              href="/login"
              className="find-match-btn inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 sm:px-12 py-4 rounded-xl text-hl-base font-black text-lg header-caps"
            >
              Log in to Play
            </Link>
          ) : (
            <button
              onClick={inQueue ? handleLeave : handleJoin}
              disabled={findDisabled}
              className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 sm:px-12 py-4 rounded-xl font-black text-lg header-caps transition-all ${inQueue
                  ? "bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20"
                  : "find-match-btn text-hl-base"
                } ${findDisabled && "opacity-50 cursor-not-allowed"}`}
            >
              {actionLoading ? "Processing…" : inQueue ? "Cancel" : "Find Match"}
            </button>
          )}
        </div>
      </Card>

      {/* Substitute CTA — live matches missing a player. Hidden while queueing,
          since you can't be waiting for a match and joining one at once. */}
      {!inQueue && (
        <Card
          className={`bg-hl-panel p-5 mb-6 ${
            subCount > 0 ? "border-hl-gold/40" : "border-hl-border"
          }`}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-hl-gold/10 border border-hl-gold/30 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-hl-gold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-black text-white">
                Only have time for a quick one? Join a match as a substitute!
              </div>
              <div className="text-sm text-hl-muted mt-0.5">
                {subCount > 0
                  ? `${subCount === 1 ? "1 live match needs" : `${subCount} live matches need`} a player right now — you earn Elo for the rounds you play.`
                  : "No match needs a player right now. Slots open when someone leaves mid-game, and they fill fast."}
              </div>
            </div>
            <Link
              href="/subs"
              className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-xl font-black text-sm header-caps ${
                subCount > 0
                  ? "find-match-btn text-hl-base"
                  : "bg-hl-panel-light text-white border border-hl-border hover:border-hl-gold/40 transition-colors"
              }`}
            >
              {subCount > 0 && <Zap className="w-4 h-4" />} Join now
            </Link>
          </div>
        </Card>
      )}

      {/* Match type / Servers (FACEIT-style). Maps stay post-match veto. */}
      <div className="mb-6">
        <div className="border-b border-hl-border mb-4 flex items-center justify-between overflow-x-auto">
          <div className="flex items-center gap-6 shrink-0">
            <button
              type="button"
              onClick={() => setPlayTab("type")}
              className={`inline-flex items-center gap-2 pb-3 border-b-2 text-sm font-bold header-caps ${
                playTab === "type" ? "text-hl-gold border-hl-gold" : "text-hl-muted border-transparent hover:text-white"
              }`}
            >
              <Swords className="w-4 h-4" />
              Match Type
            </button>
            <button
              type="button"
              onClick={() => setPlayTab("servers")}
              className={`inline-flex items-center gap-2 pb-3 border-b-2 text-sm font-bold header-caps ${
                playTab === "servers" ? "text-hl-gold border-hl-gold" : "text-hl-muted border-transparent hover:text-white"
              }`}
            >
              <Server className="w-4 h-4" />
              Servers
            </button>
          </div>
        </div>
        {playTab === "type" ? (
        <div className="grid md:grid-cols-2 max-w-4xl gap-4 items-start">
          {MATCH_TYPES.filter((mt) => !mt.pro || proEligible || matchType === QUEUE_MODE_PRO).map((mt) => {
            const active = matchType === mt.id;
            const TypeIcon = mt.icon;
            const superLocked = mt.id === QUEUE_MODE_SUPER && superPlacementBlocked;
            const typeDisabled = (selectionLocked && mt.id !== matchType) || superLocked;
            return (
              <button
                key={mt.id}
                type="button"
                disabled={typeDisabled}
                onClick={() => {
                  if (typeDisabled) return;
                  setMatchType(mt.id);
                }}
                className={`relative w-full text-left p-4 rounded-xl border overflow-hidden bg-hl-panel ${
                  active ? "border-white/60" : "border-hl-border hover:border-hl-gold/40"
                } ${typeDisabled ? "opacity-40 cursor-not-allowed hover:border-hl-border" : "transition-colors"}`}
              >
                {mt.green && (
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-hl-green/15 to-transparent pointer-events-none" />
                )}
                {mt.pro && (
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#a855f7]/15 to-transparent pointer-events-none" />
                )}
                <div className="relative flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <TypeIcon
                      className={`w-4 h-4 shrink-0 ${mt.green ? "text-hl-green" : mt.pro ? "text-[#c084fc]" : "text-white"}`}
                    />
                    <span
                      className={`text-sm font-bold truncate ${mt.green ? "text-hl-green" : mt.pro ? "text-[#c084fc]" : "text-white"}`}
                    >
                      {mt.label}
                    </span>
                    <span className="text-xs text-hl-muted shrink-0">· {modeLabel}</span>
                  </div>
                  <Info className="w-4 h-4 text-hl-muted shrink-0" />
                </div>
                <div className="relative grid grid-cols-2 gap-2">
                  {mt.features.map(({ icon: FeatIcon, text, star }) => (
                    <div
                      key={text}
                      className="flex items-center gap-1.5 rounded-md bg-hl-base/70 border border-hl-border/60 px-2 py-2"
                    >
                      <FeatIcon className="w-3.5 h-3.5 text-hl-muted shrink-0" />
                      <span className="text-[10px] font-semibold text-white/85 leading-tight min-w-0">{text}</span>
                      {star && <Star className="w-3 h-3 text-hl-green fill-current ml-auto shrink-0" />}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {QUEUE_REGIONS.map((r) => {
              const selected = region === r.id;
              const thisOpen = openRegions.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={selectionLocked && r.id !== region}
                  onClick={() => {
                    if (selectionLocked) return;
                    setRegion(r.id);
                  }}
                  className={`text-left p-4 rounded-xl border bg-hl-panel ${
                    selected ? "border-white/70" : "border-hl-border hover:border-hl-gold/40"
                  } ${selectionLocked && r.id !== region ? "opacity-40 cursor-not-allowed hover:border-hl-border" : "transition-colors"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white">{r.label}</span>
                    <span className="text-xs font-bold text-hl-muted">{r.short}</span>
                  </div>
                  <div className="mt-2 text-[11px]">
                    {thisOpen ? (
                      <span className="text-hl-green font-bold">Queue open</span>
                    ) : (
                      <span className="text-hl-muted">Closed until staff run /queue {r.short}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Web queue list */}
      <Card className="bg-hl-panel border-hl-border overflow-hidden">
        <div className="px-5 py-4 border-b border-hl-border flex items-center justify-between bg-hl-panel-light/30">
          <h3 className="font-bold text-white header-caps flex items-center gap-2">
            <Users className="w-4 h-4 text-hl-gold" /> Players queuing ({visibleQueue.length})
          </h3>
          <Badge className="bg-hl-gold/10 text-hl-gold border-hl-gold/30">Live</Badge>
        </div>
        <div className="divide-y divide-hl-border">
          {visibleQueue.length === 0 ? (
            <div className="px-5 py-8 text-center text-hl-muted text-sm">
              No one is queuing yet.
            </div>
          ) : (
            visibleQueue.map((entry, idx) => (
              <div key={entry.id} className="flex items-center justify-between px-5 py-3 hover:bg-hl-panel-light/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="text-xs text-hl-muted w-4">{idx + 1}.</div>
                  <Avatar className="w-8 h-8 border border-hl-border">
                    <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                      {entry.discord_username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-white text-sm">
                      <ClubTaggedName
                        name={entry.player_name || entry.discord_username}
                        tag={entry.clubTag}
                      />
                    </div>
                    {entry.player_name && <div className="text-[10px] text-hl-muted">Linked: {entry.player_name}</div>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Footer stat strip */}
      <div className="mt-6 border-t border-hl-border pt-4 text-center text-xs text-hl-muted">
        Players queuing: <b className="text-white stat-number">{queue.length}</b>
      </div>
    </div>
  );
}
