"use client";

/**
 * Everything the Play page knows and does (docs/QUEUE_UI_PLAN.md §5): polling,
 * join/leave with the in-flight guard, region auto-pick, the party lineup, and
 * the page state from lib/queue-ui-state.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueRegionId } from "@/lib/regions";
import type { LobbyMember } from "@/components/lobby-slots";
import { useSession } from "@/components/session-provider";
import { useMyParty } from "@/components/use-my-party";
import { usePolling } from "@/components/use-polling";
import { usePlayRegion, setQueueLocked } from "@/components/use-play-region";
import { STATUS_TTL_MS } from "@/components/status-poller";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { MATCH_TEAM_SIZE } from "@/lib/match-mode";
import { signalQueueChanged } from "@/lib/queue-signal";
import { QUEUE_REGIONS, isQueueRegion, regionMeta } from "@/lib/regions";
import { SUPER_PARTY_MAX, parseQueueMode, queueModeLabel } from "@/lib/queue-modes";
import { queueUiState } from "@/lib/queue-ui-state";
import { useReadyCheck } from "@/components/use-ready-check";
import type { RankTierLetter } from "@/types";

export interface QueueEntryView {
  id: number;
  discord_id?: string;
  discord_username?: string;
  player_name?: string | null;
  joined_at?: string;
  queue_mode?: string | null;
  clubTag?: string | null;
}

export interface PrestigeView {
  wins: number;
  level: number;
  maxed: boolean;
  nextAt: number | null;
  winsIntoLevel: number;
  winsPerLevel: number;
  maxLevel: number;
  coinsPerLevel: number;
  newlyReached: number[];
}

export interface MeView {
  player: {
    name: string;
    rank: RankTierLetter;
    elo: number;
    peakElo: number;
    placementDone: boolean;
    placementPlayed: number;
    avatar: string | null;
    country: string | null;
    card: string | null;
    frame: string | null;
    mmAccess: boolean;
    position?: number | null;
  } | null;
  season: { number: number; label: string };
  placementTotal: number;
  prestige?: PrestigeView;
  lastRegion?: string | null;
  countryRegion?: string | null;
}

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

const REGION_LABELS = Object.fromEntries(QUEUE_REGIONS.map((r) => [r.id, r.label]));

function isUnranked(rank: string | undefined | null): boolean {
  const r = (rank || "").toUpperCase();
  return !r || r === "UNRANKED" || r.includes("UNRANKED") || r.includes("[?]");
}

export function useQueueState() {
  const { session, loaded: sessionLoaded, discordInvite } = useSession();
  const { party: sharedParty } = useMyParty(session?.discordId);
  const readyCheck = useReadyCheck();
  const party = (sharedParty as unknown as PartyLite | null) ?? null;
  const { region, setRegion } = usePlayRegion();

  const [queue, setQueue] = useState<QueueEntryView[]>([]);
  const [teamSize, setTeamSize] = useState(MATCH_TEAM_SIZE);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [pending, setPending] = useState<"join" | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState("standard");
  const [openRegions, setOpenRegions] = useState<string[]>([]);
  const [openModes, setOpenModes] = useState<Record<string, string[]>>({});
  const [proEligible, setProEligible] = useState(false);
  const [queuedSpot, setQueuedSpot] = useState<{ region: string; mode: string } | null>(null);
  const [subCount, setSubCount] = useState(0);
  const [me, setMe] = useState<MeView | null>(null);
  const [inMatch, setInMatch] = useState(false);
  const [autoPicked, setAutoPicked] = useState<string | null>(null);
  const [liveMatches, setLiveMatches] = useState(0);
  const [queuingAll, setQueuingAll] = useState(0);
  const [queuingByRegion, setQueuingByRegion] = useState<Record<string, number>>({});
  const [lobby, setLobby] = useState<{ name: string; map: string | null; number: number | null } | null>(null);
  // While a join/leave is in flight, ignore poll snapshots that started before it.
  const actionInFlight = useRef(false);
  const pickedOnce = useRef(false);

  /** First visit / "GLOBAL": pick a server for them (docs/QUEUE_UI_PLAN.md §6.3).
   *  Runs when queue or profile data arrives, never while queued, at most once. */
  const tryAutoPick = (m: MeView | null, open: string[], queued: boolean) => {
    if (pickedOnce.current || queued || isQueueRegion(region)) return;
    if (session && !m) return; // wait for their last region / country
    pickedOnce.current = true;
    const country = m?.countryRegion && isQueueRegion(m.countryRegion) ? m.countryRegion : null;
    const last = m?.lastRegion && isQueueRegion(m.lastRegion) ? m.lastRegion : null;
    const only = open.length === 1 && isQueueRegion(open[0]) ? open[0] : null;
    const candidate: QueueRegionId | null =
      last ?? (country && open.includes(country) ? country : null) ?? only ?? country;
    if (candidate) {
      setRegion(candidate);
      setAutoPicked(candidate);
    }
  };

  const fetchQueue = async () => {
    try {
      const { json } = await apiGetJson<{
        queue?: QueueEntryView[];
        teamSize?: number;
        openRegions?: string[];
        region?: string;
        openModes?: Record<string, string[]>;
        me?: { region?: string; mode?: string } | null;
        proEligible?: boolean;
        liveMatches?: number;
        queuingAll?: number;
        queuingByRegion?: Record<string, number>;
      }>(`/api/queue?region=${encodeURIComponent(region)}&_=${Date.now()}`, { force: true });
      if (!actionInFlight.current) setQueue(json.queue || []);
      setTeamSize(json.teamSize || MATCH_TEAM_SIZE);
      const open = Array.isArray(json.openRegions)
        ? json.openRegions
        : typeof json.region === "string"
          ? [json.region]
          : [];
      setOpenRegions(open);
      tryAutoPick(me, open, !!(json.me && typeof json.me.region === "string"));
      setProEligible(json.proEligible === true);
      setLiveMatches(Number(json.liveMatches ?? 0));
      setQueuingAll(Number(json.queuingAll ?? 0));
      setQueuingByRegion(json.queuingByRegion && typeof json.queuingByRegion === "object" ? json.queuingByRegion : {});
      if (json.openModes && typeof json.openModes === "object") setOpenModes(json.openModes);
      if (!actionInFlight.current) {
        setQueuedSpot(
          json.me && typeof json.me.region === "string"
            ? { region: json.me.region, mode: parseQueueMode(json.me.mode) }
            : null
        );
      }
    } catch (err) {
      console.error("Queue poll error:", err);
    } finally {
      setQueueLoaded(true);
    }
  };
  const queuedNow = !!queuedSpot;
  usePolling(fetchQueue, 5000, {
    keepWhenHidden: queuedNow,
    idleSlowdown: !queuedNow,
    restartKey: `${region}:${session?.discordId ?? ""}`,
  });

  const fetchMe = async () => {
    try {
      const res = await fetch("/api/queue/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as MeView;
      setMe(data);
      if (queueLoaded) tryAutoPick(data, openRegions, !!queuedSpot);
    } catch {
      /* keep the last answer */
    }
  };
  usePolling(fetchMe, 60_000, { restartKey: session?.discordId ?? "guest" });

  usePolling(
    () =>
      apiGetJson<{ count?: number }>("/api/subs", { ttlMs: STATUS_TTL_MS })
        .then(({ json }) => setSubCount(Number(json?.count ?? 0)))
        .catch(() => undefined),
    15_000
  );

  // A live match (the bot's web_lobbies row) — shown instead of Find match.
  usePolling(
    () =>
      apiGetJson<{ lobby?: { channelName?: string; map?: string | null; selectedMap?: string | null; matchNumber?: number | null } | null }>(
        "/api/lobby",
        { ttlMs: STATUS_TTL_MS }
      )
        .then(({ json }) => {
          const l = json?.lobby ?? null;
          setInMatch(!!l);
          setLobby(
            l
              ? { name: l.channelName || "Live match", map: l.selectedMap ?? l.map ?? null, number: l.matchNumber ?? null }
              : null
          );
        })
        .catch(() => undefined),
    session ? 10_000 : null,
    { restartKey: session?.discordId ?? "" }
  );

  // Follow a queue joined elsewhere (Discord, the party leader): the server
  // switches to it, and the mode shown is the one you're queued in.
  useEffect(() => {
    if (queuedSpot && isQueueRegion(queuedSpot.region) && queuedSpot.region !== region) {
      setRegion(queuedSpot.region, { force: true });
    }
  }, [queuedSpot, region, setRegion]);
  const activeMode = queuedSpot?.mode ?? mode;

  const inQueue =
    !!queuedSpot ||
    !!(session && queue.some((q) => q.discord_id != null && String(q.discord_id) === String(session.discordId)));
  useEffect(() => {
    setQueueLocked(inQueue);
  }, [inQueue]);

  const pickRegion = useCallback(
    (next: string) => {
      if (!isQueueRegion(next)) return;
      setRegion(next);
      setAutoPicked(null);
      if (session) {
        // Remembered for next time (and other devices).
        fetch("/api/queue/region", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ region: next }),
        }).catch(() => undefined);
      }
    },
    [setRegion, session]
  );

  const act = async (kind: "join" | "leave") => {
    setPending(kind);
    actionInFlight.current = true;
    setError(null);
    try {
      const res =
        kind === "join"
          ? await fetch("/api/queue", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ region, mode: activeMode }),
            })
          : await fetch(`/api/queue?region=${encodeURIComponent(region)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      invalidateClientApi();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : kind === "join" ? "Couldn't join the queue." : "Couldn't leave the queue.");
      } else {
        if (Array.isArray(data.queue)) setQueue(data.queue);
        setQueuedSpot(kind === "join" ? { region, mode: activeMode } : null);
        signalQueueChanged();
        if (kind === "join" && session) {
          fetch("/api/queue/region", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ region }),
          }).catch(() => undefined);
        }
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setPending(null);
      actionInFlight.current = false;
    }
  };

  // --- the party lineup (your card uses your fresh rank/cosmetics) -------------
  const mine = me?.player ?? null;
  const verified = !!session && session.verified !== false;
  const linked = !!session?.playerName;
  const canQueueSelf = !!session?.inGuild && verified && linked;
  const you: LobbyMember | null = session
    ? {
        username: mine?.name || session.playerName || session.username,
        avatar: mine?.avatar || session.avatar,
        rank: mine?.rank,
        elo: mine?.placementDone ? mine.elo : null,
        leader: true,
        country: mine?.country ?? null,
        card: mine?.card ?? null,
        frame: mine?.frame ?? null,
        self: true,
        verified: verified && !!session.inGuild,
        mmAccess: !!(mine?.mmAccess || session.mmAccess),
        canQueue: canQueueSelf,
        clubTag: session.clubTag ?? null,
      }
    : null;

  let lineup: LobbyMember[] = you ? [you] : [];
  if (party && session && you) {
    const ordered = [...party.members].sort((a, b) =>
      a.discordId === party.leaderId ? -1 : b.discordId === party.leaderId ? 1 : 0
    );
    lineup = ordered.map((m) => {
      const isMe = m.discordId === session.discordId;
      if (isMe) return { ...you, leader: m.discordId === party.leaderId, card: you.card ?? m.card, frame: you.frame ?? m.frame };
      return {
        username: m.playerName || m.username,
        avatar: m.avatar ?? null,
        rank: m.rank as RankTierLetter,
        elo: m.elo,
        leader: m.discordId === party.leaderId,
        country: m.country ?? null,
        card: m.card ?? null,
        frame: m.frame ?? null,
        self: false,
        verified: m.verified ?? null,
        mmAccess: m.mmAccess ?? null,
        canQueue: m.canQueue,
        clubTag: m.clubTag,
      };
    });
  }

  const selfPlacing = !!mine && !mine.placementDone;
  const others = lineup.filter((m) => !m.self);
  const partyInfo =
    party && session
      ? {
          size: lineup.length,
          isCaptain: party.leaderId === session.discordId,
          blockedNames: others.filter((m) => m.canQueue === false).map((m) => m.username),
          placingNames: others.filter((m) => isUnranked(m.rank)).map((m) => m.username),
        }
      : null;

  const ui = queueUiState({
    loading: !sessionLoaded || !queueLoaded,
    signedIn: !!session,
    inGuild: !!session?.inGuild,
    verified,
    linked,
    region,
    regionLabel: isQueueRegion(region) ? regionMeta(region).label : "No server",
    regionIsQueueRegion: isQueueRegion(region),
    openRegions,
    openModes,
    mode: activeMode,
    modeLabel: queueModeLabel(activeMode),
    queued: queuedSpot,
    inMatch,
    matchFound: readyCheck.check?.status === "pending",
    party: partyInfo,
    selfPlacing,
    proEligible,
    superPartyMax: SUPER_PARTY_MAX,
    pending,
    regionLabels: REGION_LABELS,
  });

  const modeCounts: Record<string, number> = {};
  for (const e of queue) {
    const m = parseQueueMode(e.queue_mode);
    modeCounts[m] = (modeCounts[m] ?? 0) + 1;
  }

  return {
    session,
    discordInvite,
    ui,
    error,
    region,
    autoPicked,
    pickRegion,
    mode: activeMode,
    setMode,
    openRegions,
    openModes,
    proEligible,
    selfPlacing,
    teamSize,
    lineup,
    partyInfo,
    queue,
    modeCounts,
    subCount,
    liveMatches,
    queuingAll,
    queuingByRegion,
    lobby,
    me,
    join: () => act("join"),
    leave: () => act("leave"),
  };
}

export type QueueState = ReturnType<typeof useQueueState>;
