"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadge } from "@/components/rank-badge";
import { MapThumb } from "@/components/map-thumb";
import { RankTierLetter } from "@/types";
import { prettyMap } from "@/lib/format";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { ExternalLink, Mic, Crown, Calendar, Send, Gamepad2 } from "lucide-react";
import { SubRolePill } from "@/components/sub-role-pill";

export interface LiveLobbyMember {
  discordId: string;
  name: string;
  team: number;
  avatar: string | null;
  rank: string;
  elo?: number;
  left?: boolean;
  sub?: boolean;
}

export interface LiveLobby {
  channelId: string;
  channelName: string;
  channelUrl: string;
  voiceChannelId: string | null;
  voiceChannelUrl: string | null;
  map: string | null;
  selectedMap?: string | null;
  status: string;
  side?: { name: string; team: number } | null;
  sidePick?: { captainId: string; team: number; options: string[] } | null;
  firstVetoCaptainId?: string | null;
  captains: { team1: string | null; team2: string | null };
  veto: {
    available: boolean;
    remainingMaps: string[];
    history: { map: string; bannedByCaptainId: string }[];
    currentTurnCaptainId: string | null;
    complete: boolean;
    turnDeadlineAt?: number | null;
  } | null;
  members: LiveLobbyMember[];
  createdAt?: number;
  server?: { url: string } | null;
  matchNumber?: number | null;
  messages?: ChatLine[];
}

export interface ChatLine {
  id: number;
  authorId: string;
  authorName: string;
  content: string;
  source: "discord" | "website";
  createdAt: number;
}

function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function teamHandle(members: LiveLobbyMember[], captainId: string | null) {
  const cap = members.find((m) => m.discordId === captainId) ?? members[0];
  const slug = (cap?.name || "team").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `team_${slug}`;
}

function PlayerRow({
  member,
  captain,
}: {
  member: LiveLobbyMember;
  captain: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg bg-[#1c1c1c] border border-white/[0.06] px-2.5 py-2 ${member.left ? "opacity-50" : ""}`}>
      <Avatar className="w-8 h-8 shrink-0">
        {member.avatar ? <AvatarImage src={member.avatar} /> : null}
        <AvatarFallback className="bg-[#2a2a2a] text-[10px] font-bold text-white">
          {member.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-semibold text-white truncate flex-1">{member.name}</span>
      <SubRolePill isSub={member.sub} leftEarly={member.left} compact />
      {captain && <Crown className="w-3.5 h-3.5 text-[#ff5500] shrink-0" />}
      {typeof member.elo === "number" && member.elo > 0 && (
        <span className="text-[12px] tabular-nums text-[#8a8a8a] shrink-0">{member.elo}</span>
      )}
      <RankBadge
        rank={(member.rank || "UNRANKED") as RankTierLetter}
        size="sm"
        showGlow={false}
        className="!w-5 !h-5 shrink-0"
      />
    </div>
  );
}

/** FACEIT-style matchroom: team header, player columns, center map veto. */
export function LiveMatchRoom({
  lobby,
  selfId,
  onLobby,
}: {
  lobby: LiveLobby;
  selfId: string | null;
  onLobby: (lobby: LiveLobby) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "stats">("overview");
  const [turnEndsAt, setTurnEndsAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [messages, setMessages] = useState<ChatLine[]>(lobby.messages ?? []);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const chatListRef = useRef<HTMLDivElement>(null);

  const team1 = lobby.members.filter((m) => m.team === 1);
  const team2 = lobby.members.filter((m) => m.team === 2);
  const veto = lobby.veto;
  const myTurn = !!selfId && veto?.currentTurnCaptainId === selfId && !veto.complete;
  const mapName = lobby.selectedMap || lobby.map;
  const pickerId =
    lobby.sidePick?.captainId ||
    lobby.firstVetoCaptainId ||
    veto?.history?.[0]?.bannedByCaptainId ||
    lobby.captains.team1 ||
    null;
  const pickingSide =
    !lobby.side &&
    lobby.status !== "ready_to_play" &&
    (lobby.status === "side_selection" || !!veto?.complete);
  const mySideTurn = !!selfId && pickingSide && pickerId === selfId;
  const sideOptions = lobby.sidePick?.options?.length ? lobby.sidePick.options : ["CT", "T"];
  const picker = lobby.members.find((m) => m.discordId === pickerId);
  const name1 = teamHandle(team1, lobby.captains.team1);
  const name2 = teamHandle(team2, lobby.captains.team2);
  const av1 = team1.find((m) => m.discordId === lobby.captains.team1) ?? team1[0];
  const av2 = team2.find((m) => m.discordId === lobby.captains.team2) ?? team2[0];
  const dateLabel = lobby.createdAt
    ? new Date(lobby.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;

  useEffect(() => {
    if (!veto || veto.complete) return;
    setTurnEndsAt(veto.turnDeadlineAt || Date.now() + 30_000);
  }, [veto?.currentTurnCaptainId, veto?.complete, veto?.turnDeadlineAt]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (lobby.messages) setMessages(lobby.messages);
  }, [lobby.messages]);

  useEffect(() => {
    const loadChat = async () => {
      try {
        const res = await fetch("/api/lobby/chat");
        const data = await res.json();
        if (Array.isArray(data.messages)) setMessages(data.messages);
      } catch {
        /* ignore */
      }
    };
    loadChat();
    const id = setInterval(loadChat, 2000);
    return () => clearInterval(id);
  }, [lobby.channelId]);

  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const remainingSec = (turnEndsAt - now) / 1000;

  const sendChat = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch("/api/lobby/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const banMap = async (map: string) => {
    setBusy(map);
    setError(null);
    try {
      const res = await fetch("/api/lobby/veto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Ban failed");
      else if (data.lobby) onLobby(data.lobby as LiveLobby);
    } catch {
      setError("Ban failed");
    } finally {
      setBusy(null);
    }
  };

  const pickSide = async (side: string) => {
    setBusy(side);
    setError(null);
    try {
      const res = await fetch("/api/lobby/side", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Side pick failed");
      else if (data.lobby) onLobby(data.lobby as LiveLobby);
    } catch {
      setError("Side pick failed");
    } finally {
      setBusy(null);
    }
  };

  const vetoStatus =
    lobby.side && mapName
      ? "Map selected"
      : pickingSide
        ? mySideTurn
          ? "Your turn — pick a starting side"
          : picker
            ? `${picker.name} is picking a starting side`
            : "Waiting for side pick"
        : mapName && (veto?.complete || !veto)
          ? "Map selected"
          : veto && !veto.complete && remainingSec <= 0
            ? "Time's up — random ban incoming…"
            : myTurn
              ? "Your turn — ban a map"
              : veto?.currentTurnCaptainId
                ? "Your opponent is banning a map"
                : "Veto in progress";

  return (
    <div className="flex h-[calc(100dvh-var(--hl-topbar-h))] overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold text-white">
            Matchroom{lobby.matchNumber ? ` · #{lobby.matchNumber}` : ""}
          </h1>
          <div className="flex items-center gap-5">
            {(["overview", "stats"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`text-[12px] font-bold uppercase tracking-wide pb-1 border-b-2 ${
                  tab === t ? "text-[#ff5500] border-[#ff5500]" : "text-[#8a8a8a] border-transparent hover:text-white"
                }`}
              >
                {t === "overview" ? "Overview" : "Stats"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#8a8a8a] mb-4">
          <span>Matchmaking / {MATCH_MODE_LABEL} / Standard Match</span>
          <div className="flex items-center gap-2">
            {lobby.server?.url && (
              <a
                href={lobby.server.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gold-gradient text-hl-base text-[11px] font-black"
              >
                <Gamepad2 className="w-3.5 h-3.5" /> Join server
              </a>
            )}
            {lobby.voiceChannelUrl && (
              <a
                href={lobby.voiceChannelUrl}
                title="Opens the Discord app"
                className="xl:hidden inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#57F287] text-hl-base text-[11px] font-black"
              >
                <Mic className="w-3.5 h-3.5" /> Team voice
              </a>
            )}
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> {dateLabel}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-[#1a1a1a] border border-white/[0.06] px-5 py-4 mb-4 flex items-center justify-center gap-4">
          <span className="text-lg font-bold text-white truncate max-w-[36%] text-right">{name1}</span>
          <Avatar className="w-12 h-12 shrink-0">
            {av1?.avatar ? <AvatarImage src={av1.avatar} /> : null}
            <AvatarFallback className="bg-[#2a2a2a] text-sm font-bold text-white">
              {(av1?.name || "T1").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-black text-[#8a8a8a]">VS</span>
          <Avatar className="w-12 h-12 shrink-0">
            {av2?.avatar ? <AvatarImage src={av2.avatar} /> : null}
            <AvatarFallback className="bg-[#2a2a2a] text-sm font-bold text-white">
              {(av2?.name || "T2").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-lg font-bold text-white truncate max-w-[36%]">{name2}</span>
        </div>

        {tab === "stats" ? (
          <p className="text-sm text-[#8a8a8a] text-center py-16">Stats appear after the match ends.</p>
        ) : (
          <div className="grid lg:grid-cols-[1fr_220px_1fr] gap-4 items-start">
            <div>
              <div className="text-[12px] text-[#8a8a8a] mb-2">Players</div>
              <div className="space-y-1.5">
                {team1.map((m) => (
                  <PlayerRow key={m.discordId} member={m} captain={lobby.captains.team1 === m.discordId} />
                ))}
              </div>
            </div>

            <div className="px-1">
              <div className="text-center mb-3">
                <div className="text-[13px] font-semibold text-white">{vetoStatus}</div>
                {veto && !veto.complete && (
                  <div className="text-xl font-black tabular-nums text-white mt-1">
                    {formatClock((turnEndsAt - now) / 1000)}
                  </div>
                )}
              </div>

              {pickingSide ? (
                <div className="rounded-lg bg-[#1c1c1c] border border-white/[0.06] p-3 text-center">
                  {mapName && (
                    <>
                      <MapThumb map={mapName} className="w-full h-16 mx-auto" />
                      <div className="text-sm font-bold text-white mt-2">{prettyMap(mapName)}</div>
                    </>
                  )}
                  <div className="text-[11px] text-[#8a8a8a] mt-2 mb-2">
                    Team {lobby.sidePick?.team || picker?.team || 1} starting side
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {sideOptions.map((side) => {
                      const isCt = side.toUpperCase() === "CT";
                      return (
                        <button
                          key={side}
                          type="button"
                          disabled={!mySideTurn || busy !== null}
                          onClick={() => pickSide(side)}
                          className={`h-11 rounded-lg border text-sm font-black tracking-wide transition-colors ${
                            isCt
                              ? "bg-[#1e2a3d] border-[#5d79ae]/50 text-[#9eb6d9] hover:border-[#5d79ae] hover:bg-[#24344c]"
                              : "bg-[#2a1f14] border-[#de9b35]/50 text-[#e8b86a] hover:border-[#de9b35] hover:bg-[#3a2a18]"
                          } disabled:opacity-50 disabled:cursor-default`}
                        >
                          {busy === side ? "…" : side}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : mapName && (veto?.complete || !veto) ? (
                <div className="rounded-lg bg-[#1c1c1c] border border-white/[0.06] p-3 text-center">
                  <MapThumb map={mapName} className="w-full h-16 mx-auto" />
                  <div className="text-sm font-bold text-white mt-2">{prettyMap(mapName)}</div>
                  {lobby.side && (
                    <div className="text-[11px] text-[#8a8a8a] mt-1">
                      Team {lobby.side.team} starts {lobby.side.name}
                    </div>
                  )}
                </div>
              ) : veto ? (
                <div className="space-y-1.5">
                  {veto.remainingMaps.map((map) => (
                    <button
                      key={map}
                      type="button"
                      disabled={!myTurn || busy !== null || remainingSec <= 0}
                      onClick={() => banMap(map)}
                      className={`w-full flex items-center gap-2 rounded-lg bg-[#1c1c1c] border px-2 py-1.5 text-left transition-colors ${
                        myTurn
                          ? "border-white/10 hover:border-[#ff5500]/60 hover:bg-[#24180f]"
                          : "border-white/[0.06] cursor-default"
                      } disabled:opacity-60`}
                    >
                      <MapThumb map={map} />
                      <span className="text-sm font-semibold text-white truncate">{prettyMap(map)}</span>
                      {busy === map && <span className="ml-auto text-[11px] text-[#8a8a8a]">…</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#8a8a8a] text-center">
                  Map veto will appear here when the bot writes veto state.
                </p>
              )}
              {error && <p className="mt-2 text-xs text-hl-red text-center">{error}</p>}
            </div>

            <div>
              <div className="text-[12px] text-[#8a8a8a] mb-2 text-right lg:text-left">Players</div>
              <div className="space-y-1.5">
                {team2.map((m) => (
                  <PlayerRow key={m.discordId} member={m} captain={lobby.captains.team2 === m.discordId} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="hidden xl:flex w-[300px] shrink-0 flex-col min-h-0 h-full border-l border-white/[0.06] bg-[#141414]">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <span className="text-[12px] font-bold uppercase tracking-wide text-[#8a8a8a]">Room chat</span>
          <a
            href={lobby.channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Discord channel"
            className="text-[#8a8a8a] hover:text-white"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <div ref={chatListRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 space-y-2">
          {messages.length === 0 ? (
            <p className="text-[12px] text-[#8a8a8a]">No messages yet. Chat here or in Discord.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="text-[12px] leading-snug">
                <span className="font-semibold text-white">{m.authorName}</span>
                <span className="ml-1 text-[10px] uppercase tracking-wide text-[#6a6a6a]">
                  {m.source === "website" ? "web" : "dc"}
                </span>
                <p className="text-[#d0d0d0] whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ))
          )}
        </div>
        <form
          className="flex items-center gap-1.5 px-3 py-2 border-t border-white/[0.06] shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={400}
            placeholder="Message match chat…"
            className="flex-1 min-w-0 h-8 rounded-md bg-[#1c1c1c] border border-white/10 px-2 text-[12px] text-white placeholder:text-[#6a6a6a] focus:outline-none focus:border-[#ff5500]/50"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="h-8 w-8 rounded-md bg-gold-gradient text-hl-base flex items-center justify-center disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
        <div className="px-4 py-3 border-t border-b border-white/[0.06] text-[12px] font-bold uppercase tracking-wide text-[#8a8a8a] shrink-0">
          Connect
        </div>
        <div className="p-4 space-y-2 shrink-0">
          {lobby.server?.url ? (
            <a
              href={lobby.server.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 w-full justify-center h-9 rounded-md bg-gold-gradient text-hl-base text-xs font-black"
            >
              <Gamepad2 className="w-3.5 h-3.5" /> Join server
            </a>
          ) : (
            <p className="text-[12px] text-[#8a8a8a]">Staff will post the game server link here.</p>
          )}
          {lobby.voiceChannelUrl ? (
            <a
              href={lobby.voiceChannelUrl}
              title="Opens the Discord app"
              className="inline-flex items-center gap-2 w-full justify-center h-9 rounded-md bg-[#57F287] text-hl-base text-xs font-black"
            >
              <Mic className="w-3.5 h-3.5" /> Join team voice
            </a>
          ) : (
            <p className="text-[12px] text-[#8a8a8a]">Voice opens when the match channel is ready.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
