"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { LobbySlots, LobbyMember } from "@/components/lobby-slots";
import { UserSession, RankTierLetter } from "@/types";
import {
  AlertCircle,
  Users,
  Loader2,
  Search,
  Swords,
  Info,
  ShieldCheck,
  Activity,
  Medal,
  Star,
  Coins,
  Zap,
} from "lucide-react";

interface WebQueueEntry {
  id: number;
  discord_user_id: string;
  discord_username: string;
  player_name: string | null;
  joined_at: string;
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

/** FACEIT-style match-type cards: header + a grid of requirement chips. */
const MATCH_TYPES: {
  id: string;
  label: string;
  green?: boolean;
  features: MatchTypeFeature[];
}[] = [
  {
    id: "standard",
    label: "Standard Match",
    features: [
      { icon: Users, text: "All party sizes" },
      { icon: ShieldCheck, text: "Verified Matching", star: true },
      { icon: Activity, text: "No Elo restrictions" },
      { icon: Medal, text: "Veteran Matching", star: true },
    ],
  },
  {
    id: "super",
    label: "Super Match",
    green: true,
    features: [
      { icon: Users, text: "Solo, duo, trio" },
      { icon: ShieldCheck, text: "Verified Matching", star: true },
      { icon: Activity, text: "400 Elo range" },
      { icon: Medal, text: "Veteran Matching", star: true },
      { icon: Star, text: "Premium flex" },
    ],
  },
  {
    id: "premium",
    label: "Premium Match",
    green: true,
    features: [
      { icon: Users, text: "Solo or duo" },
      { icon: ShieldCheck, text: "Verified required" },
      { icon: Activity, text: "400 Elo range" },
      { icon: Medal, text: "Veteran required" },
      { icon: Star, text: "Premium Required" },
      { icon: Coins, text: "High stakes" },
    ],
  },
];

/** Ranked tier ladder for the skill-level segments in the header. */
const TIER_LADDER: RankTierLetter[] = ["D", "C", "B", "A1", "A2", "A3", "S1", "S2", "S3"];

/** Placement games required before a rank is assigned (matches the bot). */
const PLACEMENT_GAMES = 3;

export default function QueuePage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [party, setParty] = useState<PartyLite | null>(null);
  const [queue, setQueue] = useState<WebQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchType, setMatchType] = useState("standard");
  // While a join/leave POST is in flight (and briefly after), ignore the 5s
  // poll's queue snapshot so a poll that started before the action can't land
  // afterwards and revert the button's optimistic result.
  const actionInFlight = useRef(false);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const [qRes, sRes, pRes] = await Promise.all([
          fetch("/api/queue"),
          fetch("/api/auth/me"),
          fetch("/api/parties"),
        ]);
        const qData = await qRes.json();
        if (!actionInFlight.current) setQueue(qData.queue || []);
        const sData = await sRes.json();
        const me = sData.user as UserSession | undefined;
        if (me) setSession(me);
        // Find the party this user belongs to, so we can show teammates in the lobby.
        const pData = await pRes.json();
        const mine = me
          ? (pData.parties as PartyLite[] | undefined)?.find((p) =>
              p.members.some((m) => m.discordId === me.discordId)
            )
          : null;
        setParty(mine ?? null);
        setLoading(false);
      } catch (err) {
        console.error("Queue poll error:", err);
        setLoading(false);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

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
        }))
        .catch(() => { });
    }
  }, [session?.playerName]);

  const inQueue = session ? queue.some((q) => q.discord_user_id === session.discordId) : false;
  const canQueue = !!session?.inGuild && !!session?.playerName;

  const handleJoin = async () => {
    setActionLoading(true);
    actionInFlight.current = true;
    setError(null);
    try {
      const res = await fetch("/api/queue", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to join queue");
      else setQueue(data.queue);
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
      const res = await fetch("/api/queue", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to leave queue");
      else setQueue(data.queue);
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
      verified: session.inGuild,
      canQueue,
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
        verified: isMe ? session.inGuild : m.verified ?? null,
        canQueue: isMe ? canQueue : m.canQueue,
      };
    });
  } else {
    lobbyMembers = you ? [you] : [];
  }

  // One ineligible party member blocks the whole party from queueing.
  const partyBlocked = lobbyMembers.some((m) => m.canQueue === false);

  // Header banner state: placement progress until ranked, tier ladder after.
  const placed = !!player?.placementDone;
  const placementPlayed = Math.min(player?.placementGamesPlayed ?? 0, PLACEMENT_GAMES);
  const tierIdx = player ? TIER_LADDER.indexOf(player.rank) : -1;
  const wins = player?.wins ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Tab bar */}
      <div className="border-b border-hl-border mb-6">
        <div className="inline-flex items-center gap-2 pb-3 border-b-2 border-hl-gold">
          <Search className="w-4 h-4 text-hl-gold" />
          <span className="text-sm font-bold text-hl-gold header-caps">Matchmaking</span>
        </div>
      </div>

      {/* Queue region pill */}
      <div className="flex justify-center mb-5">
        <span className="bg-gold-gradient text-hl-base rounded-full px-4 py-1.5 text-xs font-black header-caps">
          Europe 5v5 Queue
        </span>
      </div>

      {/* Season / skill-level banner (FACEIT-style) */}
      <Card className="bg-hl-panel border-hl-border p-6 mb-6">
        <div className="flex flex-wrap items-center gap-5">
          <RankBadge rank={player?.rank ?? "UNRANKED"} size="lg" />
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
      <Card className="bg-hl-panel border-hl-border p-6 mb-6">
        {inQueue && (
          <div className="flex justify-end mb-3">
            <Badge className="bg-hl-green/15 text-hl-green border-hl-green/30 animate-pulse-glow">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Searching…
            </Badge>
          </div>
        )}

        <div className="py-3">
          <LobbySlots members={lobbyMembers} size={5} findPartiesHref="/party-finder" />
        </div>

        {/* Warning banner */}
        {session && !canQueue && (
          <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {!session.inGuild
              ? "You must be a member of the HyperLeague Discord server to queue."
              : "Your Discord account is not linked to a HyperLeague player. Contact an admin."}
          </div>
        )}
        {session && canQueue && partyBlocked && (
          <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            There are requirements one or more party members don&apos;t meet — check the warning icon above their card.
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
              className="find-match-btn inline-flex items-center gap-2 px-12 py-4 rounded-xl text-hl-base font-black text-lg header-caps"
            >
              Log in to Play
            </Link>
          ) : (
            <button
              onClick={inQueue ? handleLeave : handleJoin}
              disabled={actionLoading || loading || ((!canQueue || partyBlocked) && !inQueue)}
              className={`inline-flex items-center gap-2 px-12 py-4 rounded-xl font-black text-lg header-caps transition-all ${inQueue
                  ? "bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20"
                  : "find-match-btn text-hl-base"
                } ${(actionLoading || loading || ((!canQueue || partyBlocked) && !inQueue)) && "opacity-50 cursor-not-allowed"}`}
            >
              {actionLoading ? "Processing…" : inQueue ? "Cancel" : "Find Match"}
            </button>
          )}
        </div>
      </Card>

      {/* Match type selector (FACEIT-style requirement cards) */}
      <div className="mb-6">
        <div className="border-b border-hl-border mb-4">
          <div className="inline-flex items-center gap-2 pb-3 border-b-2 border-hl-gold">
            <Swords className="w-4 h-4 text-hl-gold" />
            <span className="text-sm font-bold text-hl-gold header-caps">Match Type</span>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4 items-start">
          {MATCH_TYPES.map((mt) => {
            const active = matchType === mt.id;
            return (
              <button
                key={mt.id}
                onClick={() => setMatchType(mt.id)}
                className={`relative w-full text-left p-4 rounded-xl border transition-colors overflow-hidden bg-hl-panel ${
                  active ? "border-white/60" : "border-hl-border hover:border-hl-gold/40"
                }`}
              >
                {mt.green && (
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-hl-green/15 to-transparent pointer-events-none" />
                )}
                <div className="relative flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {mt.green ? (
                      <Zap className="w-4 h-4 text-hl-green shrink-0" />
                    ) : (
                      <Swords className="w-4 h-4 text-white shrink-0" />
                    )}
                    <span className={`text-sm font-bold truncate ${mt.green ? "text-hl-green" : "text-white"}`}>
                      {mt.label}
                    </span>
                    <span className="text-xs text-hl-muted shrink-0">· 5v5</span>
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
      </div>

      {/* Web queue list */}
      <Card className="bg-hl-panel border-hl-border overflow-hidden">
        <div className="px-5 py-4 border-b border-hl-border flex items-center justify-between bg-hl-panel-light/30">
          <h3 className="font-bold text-white header-caps flex items-center gap-2">
            <Users className="w-4 h-4 text-hl-gold" /> Players from Web ({queue.length})
          </h3>
          <Badge className="bg-hl-gold/10 text-hl-gold border-hl-gold/30">Syncs to Discord</Badge>
        </div>
        <div className="divide-y divide-hl-border">
          {queue.length === 0 ? (
            <div className="px-5 py-8 text-center text-hl-muted text-sm">
              No one has joined from the web yet. Check the Discord bot for full queue status.
            </div>
          ) : (
            queue.map((entry, idx) => (
              <div key={entry.id} className="flex items-center justify-between px-5 py-3 hover:bg-hl-panel-light/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="text-xs text-hl-muted w-4">{idx + 1}.</div>
                  <Avatar className="w-8 h-8 border border-hl-border">
                    <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                      {entry.discord_username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-white text-sm">{entry.discord_username}</div>
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
        Players queueing: <b className="text-white stat-number">{queue.length}</b>
      </div>
    </div>
  );
}
