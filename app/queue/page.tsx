"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { LobbySlots, LobbyMember } from "@/components/lobby-slots";
import { UserSession, RankTierLetter } from "@/types";
import { AlertCircle, Users, Loader2, Search } from "lucide-react";

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
  avatarUrl: string;
  country: string | null;
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
}
interface PartyLite {
  id: string;
  leaderId: string;
  members: PartyMemberLite[];
}

const MATCH_TYPES = [
  { id: "standard", label: "Standard", desc: "Balanced 5v5 ranked" },
  { id: "super", label: "Super", desc: "Higher ELO stakes" },
  { id: "premium", label: "Premium", desc: "Verified players only" },
];

export default function QueuePage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [party, setParty] = useState<PartyLite | null>(null);
  const [queue, setQueue] = useState<WebQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchType, setMatchType] = useState("standard");

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const [qRes, sRes, pRes] = await Promise.all([
          fetch("/api/queue"),
          fetch("/api/auth/me"),
          fetch("/api/parties"),
        ]);
        const qData = await qRes.json();
        setQueue(qData.queue || []);
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
        .then((d) => d && setPlayer({ rank: d.rank, elo: d.elo, avatarUrl: d.avatarUrl, country: d.country }))
        .catch(() => { });
    }
  }, [session?.playerName]);

  const inQueue = session ? queue.some((q) => q.discord_user_id === session.discordId) : false;
  const canQueue = !!session?.inGuild && !!session?.playerName;

  const handleJoin = async () => {
    setActionLoading(true);
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
    }
  };

  const handleLeave = async () => {
    setActionLoading(true);
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
      };
    });
  } else {
    lobbyMembers = you ? [you] : [];
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Tab bar */}
      <div className="border-b border-hl-border mb-6">
        <div className="inline-flex items-center gap-2 pb-3 border-b-2 border-hl-gold">
          <Search className="w-4 h-4 text-hl-gold" />
          <span className="text-sm font-bold text-hl-gold header-caps">Matchmaking</span>
        </div>
      </div>

      {/* Season + rank display */}
      <Card className="bg-hl-panel border-hl-border p-5 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          {player ? <RankBadge rank={player.rank} size="lg" /> : <RankBadge rank="UNRANKED" size="lg" />}
          <div>
            <div className="text-xs text-hl-muted header-caps">Season 1</div>
            <div className="stat-number text-2xl text-hl-gold">{player?.elo ?? "—"}</div>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-hl-muted header-caps">Region</div>
          <div className="text-sm font-bold text-white">EU · Blox Strike</div>
        </div>
      </Card>

      {/* Lobby slots */}
      <Card className="bg-hl-panel border-hl-border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white header-caps flex items-center gap-2">
            <Users className="w-4 h-4 text-hl-gold" /> Your Lobby
          </h2>
          {inQueue && (
            <Badge className="bg-hl-green/15 text-hl-green border-hl-green/30 animate-pulse-glow">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Searching…
            </Badge>
          )}
        </div>

        <LobbySlots members={lobbyMembers} size={5} findPartiesHref="/party-finder" />

        {/* Warning banner */}
        {session && !canQueue && (
          <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {!session.inGuild
              ? "You must be a member of the HyperLeague Discord server to queue."
              : "Your Discord account is not linked to a HyperLeague player. Contact an admin."}
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
              disabled={actionLoading || loading || (!canQueue && !inQueue)}
              className={`inline-flex items-center gap-2 px-12 py-4 rounded-xl font-black text-lg header-caps transition-all ${inQueue
                  ? "bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20"
                  : "find-match-btn text-hl-base"
                } ${(actionLoading || loading || (!canQueue && !inQueue)) && "opacity-50 cursor-not-allowed"}`}
            >
              {actionLoading ? "Processing…" : inQueue ? "Cancel" : "Find Match"}
            </button>
          )}
        </div>
      </Card>

      {/* Match type selector */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        {MATCH_TYPES.map((mt) => (
          <button
            key={mt.id}
            onClick={() => setMatchType(mt.id)}
            className={`text-left p-4 rounded-xl border transition-colors ${matchType === mt.id
                ? "border-hl-gold/50 bg-hl-gold/10"
                : "border-hl-border bg-hl-panel hover:border-hl-gold/30"
              }`}
          >
            <div className={`text-sm font-bold ${matchType === mt.id ? "text-hl-gold" : "text-white"}`}>
              {mt.label}
            </div>
            <div className="text-xs text-hl-muted mt-0.5">{mt.desc}</div>
          </button>
        ))}
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
    </div>
  );
}
