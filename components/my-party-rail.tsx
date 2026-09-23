"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Crown,
  Headphones,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  UserSearch,
  UsersRound,
} from "lucide-react";
import { RankTierLetter } from "@/types";
import { RankBadge } from "@/components/rank-badge";
import { MATCH_MODE_LABEL, PARTY_MAX_SIZE } from "@/lib/match-mode";
import { RailBadge } from "@/components/rail-badge";
import { useSession } from "@/components/session-provider";
import { OnlineBadge, OnlineLabel, useOnline } from "@/components/online-status";
import { usePartyChat } from "@/components/party-chat";
import { ChatThread } from "@/components/chat-thread";
import { IconTabs, RailDrawer } from "@/components/rail-drawer";
import { refreshMyParty, useMyParty, type PartyMemberLite } from "@/components/use-my-party";

export type PartyTab = "chat" | "invite" | "voice";

interface SearchHit {
  name: string;
  avatar: string | null;
  rank: string;
}

function MemberAvatar({ m, size = "sm" }: { m: PartyMemberLite; size?: "sm" | "md" }) {
  const label = m.playerName || m.username;
  const cls = size === "md" ? "w-8 h-8 text-[10px]" : "w-6 h-6 text-[8px]";
  return m.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.avatar} alt="" referrerPolicy="no-referrer" className={`${cls} rounded-full object-cover`} />
  ) : (
    <span className={`${cls} rounded-full bg-[#2a2a2a] font-bold text-[#c8c8c8] flex items-center justify-center`}>
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Right-rail party block + the FACEIT-style Party panel. */
export function MyPartyRail({
  open,
  tab,
  onOpen,
  onClose,
  railRef,
}: {
  open: boolean;
  tab: PartyTab;
  onOpen: (tab: PartyTab) => void;
  onClose: () => void;
  railRef: React.RefObject<HTMLElement | null>;
}) {
  const { session } = useSession();
  const me = session?.discordId ?? null;
  const { party } = useMyParty(me);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const chatVisible = open && tab === "chat" && !!party;
  const chat = usePartyChat(party?.id ?? null, me, chatVisible);
  const isOnline = useOnline({ ids: party?.members.map((m) => m.discordId) ?? [] });
  const isLeader = !!(me && party && party.leaderId === me);

  useEffect(() => {
    if (open && tab === "invite") searchRef.current?.focus();
  }, [open, tab, party?.id]);

  useEffect(() => {
    const q = query.trim();
    if (tab !== "invite" || q.length < 2) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setHits(data.players ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, tab]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refreshMyParty(true);
    } finally {
      setBusy(false);
    }
  };

  const createParty = () =>
    act(async () => {
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const res = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Party",
          gameMode: MATCH_MODE_LABEL,
          matchType: "Standard",
          maxSize: PARTY_MAX_SIZE,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) flash(data.error || "Failed to create party");
      else if (!data.party?.voiceChannelUrl) {
        flash("Party created. Discord voice wasn't created — check the bot token and channel permissions.");
      }
    });

  const leave = () =>
    act(async () => {
      if (!party) return;
      await fetch(`/api/parties/${party.id}/leave`, { method: "DELETE" });
      setConfirmLeave(false);
    });

  const kick = (discordId: string) =>
    act(async () => {
      if (!party) return;
      const res = await fetch(`/api/parties/${party.id}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) flash(data.error || "Failed to kick");
    });

  const makeCaptain = (discordId: string) =>
    act(async () => {
      if (!party) return;
      const res = await fetch(`/api/parties/${party.id}/captain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId }),
      });
      const data = await res.json().catch(() => ({}));
      flash(res.ok ? "Captain transferred." : data.error || "Failed to transfer captain");
    });

  const invite = (toName: string) =>
    act(async () => {
      if (!party) return;
      const res = await fetch(`/api/parties/${party.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) flash(data.error || "Failed to invite");
      else flash(data.status === "pending" ? "Invite already sent." : `Invited ${toName}.`);
      setQuery("");
      setHits([]);
    });

  const railBtn =
    "relative flex items-center justify-center w-11 h-10 text-[#8a8a8a] hover:text-white hover:bg-white/5";

  return (
    <>
      {/* --- rail block ------------------------------------------------ */}
      <div className="flex flex-col items-center rounded-lg border border-white/10">
        <button
          type="button"
          title={party ? `${party.name} — party` : "Party"}
          aria-label="Open party"
          aria-expanded={open}
          onClick={() => (open ? onClose() : onOpen("chat"))}
          className={`${railBtn} ${open ? "text-white bg-white/[0.06]" : ""}`}
        >
          {open ? (
            <span className="absolute -left-[3px] top-2 bottom-2 w-[3px] rounded-r-full bg-white" />
          ) : null}
          <span className="relative">
            <UsersRound className="w-[18px] h-[18px]" strokeWidth={1.75} />
            {party ? <RailBadge count={party.members.length} /> : null}
            {chat.unread > 0 ? (
              <span
                title={`${chat.unread} new party message${chat.unread === 1 ? "" : "s"}`}
                className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-[#ff5500] ring-2 ring-[#181818]"
              />
            ) : null}
          </span>
        </button>
        <button
          type="button"
          title="Invite to party"
          aria-label="Invite to party"
          onClick={() => onOpen("invite")}
          className={`${railBtn} border-t border-white/10`}
        >
          <span className="w-6 h-6 rounded-full border border-current flex items-center justify-center">
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
        </button>
        {party?.members.map((m) => (
          <button
            key={m.discordId}
            type="button"
            title={m.playerName || m.username}
            onClick={() => onOpen("chat")}
            className="flex items-center justify-center w-11 h-9 hover:bg-white/5"
          >
            <OnlineBadge online={isOnline({ id: m.discordId })} size="xs">
              <MemberAvatar m={m} />
            </OnlineBadge>
          </button>
        ))}
        {party?.voiceChannelUrl ? (
          <a
            href={party.voiceChannelUrl}
            title="Join party voice in the Discord app"
            aria-label="Join party voice"
            className={`${railBtn} text-[#ff5500] hover:text-[#ff7a33]`}
          >
            <Headphones className="w-4 h-4" strokeWidth={1.75} />
          </a>
        ) : null}
      </div>

      {/* --- panel -------------------------------------------------------- */}
      <RailDrawer
        open={open}
        onClose={onClose}
        ignoreRef={railRef}
        label="Party"
        title={party ? party.name : "Party"}
      >
        {notice ? (
          <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-[#ff5500]/15 text-[#ff8a4d] text-xs">{notice}</div>
        ) : null}

        {!session ? (
          <div className="px-4 py-6 text-sm text-[#8a8a8a]">
            <Link href="/login" className="text-[#ff5500] font-bold hover:underline">
              Log in
            </Link>{" "}
            to create a party.
          </div>
        ) : !party ? (
          <div className="px-4 py-8 flex flex-col items-center text-center gap-3">
            <span className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center text-[#8a8a8a]">
              <UsersRound className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-white">You&apos;re not in a party</p>
              <p className="text-xs text-[#8a8a8a] mt-1">
                Create one to chat, invite friends and queue together.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={createParty}
              className="w-full h-9 rounded-md bg-gold-gradient text-hl-base text-xs font-black header-caps disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create party"}
            </button>
          </div>
        ) : (
          <>
            {/* members strip */}
            <div className="mx-4 rounded-lg border border-white/[0.08] bg-[#1b1b1b]">
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-2.5">
                {party.members.map((m) => (
                  <span key={m.discordId} className="relative" title={m.playerName || m.username}>
                    {m.discordId === party.leaderId ? (
                      <Crown className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-3 h-3 text-[#f5c518] fill-[#f5c518] z-10" />
                    ) : null}
                    <OnlineBadge online={isOnline({ id: m.discordId })} size="xs">
                      <MemberAvatar m={m} size="md" />
                    </OnlineBadge>
                  </span>
                ))}
                {party.members.length < party.maxSize ? (
                  <button
                    type="button"
                    title="Invite to party"
                    aria-label="Invite to party"
                    onClick={() => onOpen("invite")}
                    className="w-8 h-8 rounded-full border border-white/15 text-[#8a8a8a] hover:text-white hover:border-white/30 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMembersOpen((v) => !v)}
                  aria-expanded={membersOpen}
                  aria-label={membersOpen ? "Hide members" : "Show members"}
                  className="ml-auto p-1 text-[#8a8a8a] hover:text-white"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${membersOpen ? "rotate-180" : ""}`} />
                </button>
              </div>
              {membersOpen ? (
                <ul className="border-t border-white/[0.06] py-1">
                  {party.members.map((m) => {
                    const self = m.discordId === me;
                    const label = m.playerName || m.username;
                    return (
                      <li key={m.discordId} className="flex items-center gap-2 px-3 py-1.5">
                        <OnlineBadge online={isOnline({ id: m.discordId })} size="xs">
                          <MemberAvatar m={m} />
                        </OnlineBadge>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 text-[13px] font-semibold text-white">
                            <span className="truncate">
                              {m.clubTag ? <span className="text-hl-gold mr-1">[{m.clubTag}]</span> : null}
                              {label}
                            </span>
                            {m.discordId === party.leaderId ? (
                              <Crown className="w-3 h-3 text-[#f5c518] shrink-0" />
                            ) : null}
                            {self ? <span className="text-[10px] text-[#8a8a8a]">(you)</span> : null}
                          </div>
                          {isLeader && !self ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => makeCaptain(m.discordId)}
                                className="text-[11px] text-hl-gold hover:underline"
                              >
                                Make captain
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => kick(m.discordId)}
                                className="text-[11px] text-hl-red hover:underline"
                              >
                                Kick
                              </button>
                            </div>
                          ) : (
                            <OnlineLabel online={isOnline({ id: m.discordId })} />
                          )}
                        </div>
                        <RankBadge
                          rank={(m.rank || "UNRANKED") as RankTierLetter}
                          size="sm"
                          showGlow={false}
                          className="!w-5 !h-5"
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            {/* voice card */}
            <div className="mx-4 mt-2 mb-3 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#1b1b1b] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-bold text-white">
                  Voice
                  <span className="rounded bg-[#ff5500] px-1 text-[9px] font-black uppercase leading-[14px] text-[#111]">
                    Beta
                  </span>
                </div>
                <div className="text-[11px] text-[#8a8a8a]">
                  {party.voiceChannelUrl ? "Ready to start" : "Not available"}
                </div>
              </div>
              {party.voiceChannelUrl ? (
                <a
                  href={party.voiceChannelUrl}
                  title="Opens the Discord app"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-black uppercase text-[#ff5500] hover:bg-white/5"
                >
                  <Headphones className="w-4 h-4" />
                  Join
                </a>
              ) : null}
            </div>

            <IconTabs<PartyTab>
              value={tab}
              onChange={(t) => onOpen(t)}
              tabs={[
                {
                  id: "chat",
                  label: "Party chat",
                  icon: <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />,
                  dot: chat.unread > 0,
                },
                {
                  id: "invite",
                  label: "Find players",
                  icon: <UserSearch className="w-[18px] h-[18px]" strokeWidth={1.75} />,
                },
                {
                  id: "voice",
                  label: "Voice",
                  icon: <Headphones className="w-[18px] h-[18px]" strokeWidth={1.75} />,
                },
              ]}
              trailing={
                confirmLeave ? (
                  <span className="flex items-center gap-1 pr-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={leave}
                      className="rounded px-2 py-1 text-[11px] font-black uppercase text-hl-red hover:bg-hl-red/10"
                    >
                      Leave
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(false)}
                      className="rounded px-2 py-1 text-[11px] text-[#8a8a8a] hover:text-white"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    title="Leave party"
                    aria-label="Leave party"
                    onClick={() => setConfirmLeave(true)}
                    className="w-11 h-10 flex items-center justify-center text-hl-red hover:bg-hl-red/10"
                  >
                    <LogOut className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  </button>
                )
              }
            />

            {tab === "chat" ? (
              <ChatThread
                messages={chat.messages}
                me={me}
                canDelete={(m) => m.authorId === me || isLeader}
                onDelete={chat.remove}
                onSend={chat.send}
                placeholder="Message your party…"
              />
            ) : tab === "invite" ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#8a8a8a] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (e.target.value.trim().length < 2) setHits([]);
                    }}
                    placeholder="Search players to invite…"
                    aria-label="Search players to invite"
                    className="w-full bg-[#1f1f1f] border border-white/10 rounded-md pl-8 pr-2 py-2 text-sm text-white placeholder:text-[#6a6a6a] focus:outline-none focus:border-[#ff5500]/50"
                  />
                </div>
                {query.trim().length >= 2 ? (
                  <div className="rounded-md border border-white/10 overflow-hidden">
                    {searching && hits.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[#8a8a8a]">Searching…</div>
                    ) : hits.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[#8a8a8a]">No players found.</div>
                    ) : (
                      hits.map((h) => {
                        const inParty = party.members.some((m) => m.playerName === h.name);
                        const invited = (party.invitedNames ?? []).includes(h.name);
                        return (
                          <button
                            key={h.name}
                            type="button"
                            disabled={busy || inParty || invited}
                            onClick={() => invite(h.name)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.05] disabled:opacity-50"
                          >
                            {h.avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={h.avatar} alt="" referrerPolicy="no-referrer" className="w-6 h-6 rounded-full object-cover" />
                            ) : (
                              <span className="w-6 h-6 rounded-full bg-[#2a2a2a] text-[9px] font-bold text-[#c8c8c8] flex items-center justify-center">
                                {h.name.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                            <span className="text-sm text-white truncate flex-1">{h.name}</span>
                            <span className="text-[11px] font-bold text-[#ff5500]">
                              {inParty ? "In party" : invited ? "Invited" : "Invite"}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#8a8a8a]">
                    Type at least 2 letters. Friends can also be invited from the Social panel.
                  </p>
                )}
                {(party.invitedNames ?? []).length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7a7a7a] mb-1">
                      Pending invites
                    </p>
                    <p className="text-xs text-[#bdbdbd]">{party.invitedNames!.join(", ")}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 text-sm text-[#bdbdbd]">
                <p>
                  Party voice is a private Discord channel just for this party. Joining opens the
                  Discord app.
                </p>
                {party.voiceChannelUrl ? (
                  <a
                    href={party.voiceChannelUrl}
                    className="flex items-center justify-center gap-2 h-9 rounded-md bg-gold-gradient text-hl-base text-xs font-black header-caps"
                  >
                    <Headphones className="w-4 h-4" /> Join party voice
                  </a>
                ) : (
                  <p className="text-xs text-[#8a8a8a]">
                    No voice channel for this party — the bot couldn&apos;t create one.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </RailDrawer>
    </>
  );
}
