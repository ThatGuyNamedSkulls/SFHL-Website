"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Hash,
  MessageSquare,
  Search,
  Swords,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useOnline } from "@/components/online-status";
import { ChatThread, usePolledChat, type ThreadMessage } from "@/components/chat-thread";
import { RailDrawer, TextTabs } from "@/components/rail-drawer";
import { useMyParty } from "@/components/use-my-party";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { RAIL_CHAT_MESSAGES, onlineBadgeCount } from "@/lib/chat-limits";

const OPEN_POLL_MS = 15000;
const CLOSED_POLL_MS = 30000;

interface Friend {
  name: string;
  avatar: string | null;
  rank: string;
}
interface RequestView {
  name: string;
  friend: Friend;
}
interface FriendsData {
  friends: Friend[];
  incoming: RequestView[];
  outgoing: RequestView[];
}

type SocialTab = "friends" | "chats";
type OpenChat = { kind: "match" } | { kind: "club"; id: string; name: string; tag: string };

/** Friends + requests for the signed-in player, polled for the rail badge. */
function useFriends(enabled: boolean, open: boolean) {
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [] });
  const [linked, setLinked] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/friends", { cache: "no-store" });
      if (res.status === 403) {
        setLinked(false);
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      setLinked(true);
      setData({
        friends: json.friends ?? [],
        incoming: json.incoming ?? [],
        outgoing: json.outgoing ?? [],
      });
    } catch {
      /* keep the last list */
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(load, 0);
    const id = window.setInterval(load, open ? OPEN_POLL_MS : CLOSED_POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [enabled, open, load]);
  return { ...data, linked, reload: load };
}

function StatusAvatar({ name, avatar, online }: { name: string; avatar: string | null; online: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover" />
      ) : (
        <span className="w-8 h-8 rounded-full bg-[#2a2a2a] text-[10px] font-bold text-[#c8c8c8] flex items-center justify-center">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span
        aria-label={online ? "Online" : "Offline"}
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#161616] ${
          online ? "bg-hl-green" : "bg-[#5a5a5a]"
        }`}
      />
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-3 pb-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#9a9a9a]">
      {children}
    </p>
  );
}

/** Rail button (green online-friends count) + the Social panel. */
export function SocialRail({
  open,
  onToggle,
  onClose,
  onOpenPartyChat,
  railRef,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenPartyChat: () => void;
  railRef: React.RefObject<HTMLElement | null>;
}) {
  const { session } = useSession();
  const me = session?.discordId ?? null;
  const friends = useFriends(!!session?.playerName, open);
  const isOnline = useOnline({ names: friends.friends.map((f) => f.name) });
  const onlineCount = friends.friends.filter((f) => isOnline({ name: f.name })).length;
  const incoming = friends.incoming.length;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Social — ${onlineCount} friend${onlineCount === 1 ? "" : "s"} online`}
        title={`Friends · ${onlineCount} online`}
        className={`relative flex items-center justify-center w-11 h-11 rounded-md transition-colors ${
          open ? "text-white bg-white/[0.06]" : "text-[#8b8b8b] hover:text-white hover:bg-white/5"
        }`}
      >
        {open ? (
          <span className="absolute -left-[10px] top-2 bottom-2 w-[3px] rounded-r-full bg-white" />
        ) : null}
        <span className="relative">
          <Users className="w-5 h-5" strokeWidth={1.75} />
          {onlineCount > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-hl-green text-[#0c1a10] text-[9px] font-black leading-[15px] text-center pointer-events-none">
              {onlineBadgeCount(onlineCount)}
            </span>
          ) : null}
          {incoming > 0 ? (
            <span
              title={`${incoming} friend request${incoming === 1 ? "" : "s"}`}
              className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-[#ff5500] ring-2 ring-[#181818]"
            />
          ) : null}
        </span>
      </button>

      <SocialDrawer
        open={open}
        onClose={onClose}
        railRef={railRef}
        me={me}
        friends={friends}
        isOnline={isOnline}
        onOpenPartyChat={onOpenPartyChat}
      />
    </>
  );
}

function SocialDrawer({
  open,
  onClose,
  railRef,
  me,
  friends,
  isOnline,
  onOpenPartyChat,
}: {
  open: boolean;
  onClose: () => void;
  railRef: React.RefObject<HTMLElement | null>;
  me: string | null;
  friends: ReturnType<typeof useFriends>;
  isOnline: (who: { name?: string | null; id?: string | null }) => boolean;
  onOpenPartyChat: () => void;
}) {
  const { session } = useSession();
  const [tab, setTab] = useState<SocialTab>("friends");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [openChat, setOpenChat] = useState<OpenChat | null>(null);
  const { party, refresh: refreshParty } = useMyParty(me);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? friends.friends.filter((f) => f.name.toLowerCase().includes(q)) : friends.friends;
  }, [filter, friends.friends]);
  const online = shown.filter((f) => isOnline({ name: f.name }));
  const offline = shown.filter((f) => !isOnline({ name: f.name }));

  const respond = async (name: string, accept: boolean) => {
    await fetch(`/api/friends/${accept ? "accept" : "reject"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromName: name }),
    });
    invalidateClientApi("/api/friends?counts=1");
    await friends.reload();
  };

  const inviteToParty = async (name: string) => {
    if (!party) return;
    const res = await fetch(`/api/parties/${party.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toName: name }),
    });
    const data = await res.json().catch(() => ({}));
    flash(!res.ok ? data.error || "Failed to invite" : data.status === "pending" ? "Invite already sent." : `Invited ${name} to your party.`);
    await refreshParty(true);
  };

  const friendRow = (f: Friend) => {
    const on = isOnline({ name: f.name });
    const inParty = !!party?.members.some((m) => m.playerName === f.name);
    return (
      <li key={f.name} className="group flex items-center gap-3 px-4 py-2 hover:bg-white/[0.03]">
        <StatusAvatar name={f.name} avatar={f.avatar} online={on} />
        <Link
          href={`/profile?player=${encodeURIComponent(f.name)}`}
          className={`min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline ${on ? "text-white" : "text-[#bdbdbd]"}`}
        >
          {f.name}
        </Link>
        {party && !inParty ? (
          <button
            type="button"
            onClick={() => inviteToParty(f.name)}
            title={`Invite ${f.name} to your party`}
            aria-label={`Invite ${f.name} to your party`}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-md p-1.5 text-[#8a8a8a] hover:text-[#ff5500] hover:bg-white/5"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        ) : null}
      </li>
    );
  };

  const title = openChat ? (
    <span className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={() => setOpenChat(null)}
        aria-label="Back to chats"
        className="p-1 -ml-1 text-[#8a8a8a] hover:text-white rounded-md"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <span className="truncate">
        {openChat.kind === "match" ? "Match chat" : openChat.name}
      </span>
    </span>
  ) : (
    "Social"
  );

  return (
    <RailDrawer
      open={open}
      onClose={onClose}
      ignoreRef={railRef}
      label="Social"
      title={title}
      actions={
        !openChat && session?.playerName ? (
          <button
            type="button"
            onClick={() => {
              setAdding((v) => !v);
              setTab("friends");
            }}
            aria-pressed={adding}
            title="Add friend"
            aria-label="Add friend"
            className={`w-8 h-8 rounded-md flex items-center justify-center border transition-colors ${
              adding
                ? "border-[#f5c518] text-[#f5c518]"
                : "border-transparent text-[#8a8a8a] hover:text-white hover:bg-white/5"
            }`}
          >
            <UserPlus className="w-4 h-4" />
          </button>
        ) : null
      }
    >
      {!session ? (
        <p className="px-4 py-6 text-sm text-[#8a8a8a]">
          <Link href="/login" className="text-[#ff5500] font-bold hover:underline">
            Log in
          </Link>{" "}
          to see your friends and chats.
        </p>
      ) : openChat ? (
        <OpenChatView chat={openChat} me={me} />
      ) : (
        <>
          <TextTabs<SocialTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "friends", label: "Friends", badge: friends.incoming.length },
              { id: "chats", label: "Chats" },
            ]}
          />
          {notice ? (
            <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-[#ff5500]/15 text-[#ff8a4d] text-xs">{notice}</div>
          ) : null}
          {tab === "friends" ? (
            !friends.linked ? (
              <p className="px-4 py-6 text-sm text-[#8a8a8a]">
                Your Discord account isn&apos;t linked to a HyperLeague player yet, so friends aren&apos;t
                available.
              </p>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pb-3">
                {adding ? (
                  <AddFriend
                    friends={friends.friends}
                    outgoing={friends.outgoing}
                    onAdded={async (name) => {
                      flash(`Friend request sent to ${name}.`);
                      await friends.reload();
                    }}
                  />
                ) : (
                  <div className="px-4 pt-3">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#8a8a8a] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Search"
                        aria-label="Search friends"
                        className="w-full bg-[#1f1f1f] border border-white/10 rounded-md pl-8 pr-2 py-2 text-[13px] text-white placeholder:text-[#8a8a8a] focus:outline-none focus:border-[#ff5500]/50"
                      />
                    </div>
                  </div>
                )}

                {friends.incoming.length > 0 ? (
                  <>
                    <SectionLabel>Requests ({friends.incoming.length})</SectionLabel>
                    <ul>
                      {friends.incoming.map((r) => (
                        <li key={r.name} className="flex items-center gap-3 px-4 py-2">
                          <StatusAvatar
                            name={r.name}
                            avatar={r.friend.avatar}
                            online={isOnline({ name: r.name })}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
                            {r.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => respond(r.name, true)}
                            title="Accept"
                            aria-label={`Accept ${r.name}`}
                            className="rounded-md p-1.5 text-hl-green hover:bg-hl-green/10"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => respond(r.name, false)}
                            title="Decline"
                            aria-label={`Decline ${r.name}`}
                            className="rounded-md p-1.5 text-hl-red hover:bg-hl-red/10"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="mx-4 my-1 h-px bg-white/[0.06]" />
                  </>
                ) : null}

                <SectionLabel>Online ({online.length})</SectionLabel>
                <ul>{online.map(friendRow)}</ul>
                <div className="mx-4 my-1 h-px bg-white/[0.06]" />
                <SectionLabel>Offline ({offline.length})</SectionLabel>
                <ul>{offline.map(friendRow)}</ul>

                {friends.friends.length === 0 ? (
                  <p className="px-4 pt-3 text-xs text-[#8a8a8a]">
                    No friends yet — use the add friend button above.
                  </p>
                ) : null}
                <div className="px-4 pt-4">
                  <Link href="/friends" className="text-[12px] font-bold text-[#8a8a8a] hover:text-white">
                    Manage friends →
                  </Link>
                </div>
              </div>
            )
          ) : (
            <ChatList
              visible={open && tab === "chats"}
              partyName={party?.name ?? null}
              partySize={party?.members.length ?? 0}
              onOpenParty={onOpenPartyChat}
              onOpen={setOpenChat}
            />
          )}
        </>
      )}
    </RailDrawer>
  );
}

/** Search the player base and send a friend request. */
function AddFriend({
  friends,
  outgoing,
  onAdded,
}: {
  friends: Friend[];
  outgoing: RequestView[];
  onAdded: (name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Friend[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setHits(data.players ?? []);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const add = async (name: string) => {
    setError(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toName: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "Could not send the request");
    else await onAdded(name);
  };

  const friendNames = new Set(friends.map((f) => f.name));
  const pending = new Set(outgoing.map((r) => r.name));
  return (
    <div className="px-4 pt-3">
      <div className="relative">
        <UserPlus className="w-3.5 h-3.5 text-[#f5c518] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 2) setHits([]);
          }}
          placeholder="Find players to add"
          aria-label="Find players to add as friends"
          className="w-full bg-[#1f1f1f] border border-[#f5c518]/40 rounded-md pl-8 pr-2 py-2 text-[13px] text-white placeholder:text-[#8a8a8a] focus:outline-none focus:border-[#f5c518]"
        />
      </div>
      {error ? <p className="pt-2 text-[11px] text-hl-red">{error}</p> : null}
      {query.trim().length >= 2 ? (
        <ul className="mt-2 rounded-md border border-white/10 overflow-hidden">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[#8a8a8a]">No players found.</li>
          ) : (
            hits.map((h) => {
              const state = friendNames.has(h.name) ? "Friends" : pending.has(h.name) ? "Pending" : null;
              return (
                <li key={h.name} className="flex items-center gap-2 px-3 py-2">
                  <StatusAvatar name={h.name} avatar={h.avatar} online={false} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white">{h.name}</span>
                  {state ? (
                    <span className="text-[11px] text-[#8a8a8a]">{state}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => add(h.name)}
                      className="rounded-md px-2 py-1 text-[11px] font-black uppercase text-[#ff5500] hover:bg-white/5"
                    >
                      Add
                    </button>
                  )}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

interface ClubRow {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  chatTimes?: number[];
}

/** The CHATS tab: party, live match and club conversations. */
function ChatList({
  visible,
  partyName,
  partySize,
  onOpenParty,
  onOpen,
}: {
  visible: boolean;
  partyName: string | null;
  partySize: number;
  onOpenParty: () => void;
  onOpen: (chat: OpenChat) => void;
}) {
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [match, setMatch] = useState<{ number: number | null; name: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const [c, l] = await Promise.all([
          apiGetJson<{ clubs?: ClubRow[] }>("/api/clubs/sidebar"),
          fetch("/api/lobby", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        setClubs(c.ok ? c.json.clubs ?? [] : []);
        const lobby = (l as { lobby?: { matchNumber?: number | null; channelName?: string } }).lobby;
        setMatch(lobby ? { number: lobby.matchNumber ?? null, name: lobby.channelName ?? "Match" } : null);
      } catch {
        /* keep what we have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const row = (
    key: string,
    icon: React.ReactNode,
    title: string,
    subtitle: string,
    onClick: () => void
  ) => (
    <li key={key}>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]"
      >
        <span className="w-8 h-8 rounded-full bg-[#232323] flex items-center justify-center text-[#bdbdbd] shrink-0 overflow-hidden">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{title}</span>
          <span className="block truncate text-[11px] text-[#8a8a8a]">{subtitle}</span>
        </span>
        <MessageSquare className="w-3.5 h-3.5 text-[#6a6a6a]" />
      </button>
    </li>
  );

  const items: React.ReactNode[] = [];
  if (partyName) {
    items.push(
      row("party", <UsersRound className="w-4 h-4" />, partyName, `Party · ${partySize} member${partySize === 1 ? "" : "s"}`, onOpenParty)
    );
  }
  if (match) {
    items.push(
      row(
        "match",
        <Swords className="w-4 h-4" />,
        match.number ? `Match #${match.number}` : match.name,
        "Live match room",
        () => onOpen({ kind: "match" })
      )
    );
  }
  for (const c of clubs) {
    const last = c.chatTimes?.[0];
    items.push(
      row(
        `club-${c.id}`,
        c.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.logoUrl} alt="" className="w-8 h-8 object-cover" />
        ) : (
          <Hash className="w-4 h-4" />
        ),
        c.name,
        `Clan · [${c.tag}]${last ? ` · ${new Date(last).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}`,
        () => onOpen({ kind: "club", id: c.id, name: c.name, tag: c.tag })
      )
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-2">
      {items.length ? (
        <ul>{items}</ul>
      ) : (
        <p className="px-4 py-6 text-sm text-[#8a8a8a]">
          No chats yet. Join a party, a clan or a match to start one.
        </p>
      )}
      <p className="px-4 pt-3 text-[11px] text-[#6a6a6a]">
        Each chat shows its last {RAIL_CHAT_MESSAGES} messages.
      </p>
    </div>
  );
}

interface LobbyMsg {
  id: number;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
}
interface ClubMsg {
  id: number;
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  message: string;
  createdAt: number;
}

function clubToThread(m: ClubMsg): ThreadMessage {
  return {
    id: m.id,
    authorId: m.discordId,
    name: m.playerName || m.username,
    profileName: m.playerName,
    avatar: m.avatar,
    text: m.message,
    createdAt: m.createdAt,
  };
}

/** A match or club conversation opened from the CHATS tab (last 10 only). */
function OpenChatView({ chat, me }: { chat: OpenChat; me: string | null }) {
  const clubId = chat.kind === "club" ? chat.id : null;

  const load = useCallback(async (): Promise<ThreadMessage[]> => {
    if (chat.kind === "match") {
      const res = await fetch(`/api/lobby/chat?limit=${RAIL_CHAT_MESSAGES}`, { cache: "no-store" });
      const data = (await res.json()) as { messages?: LobbyMsg[] };
      return (data.messages ?? []).map((m) => ({
        id: m.id,
        authorId: m.authorId,
        name: m.authorName,
        profileName: null,
        avatar: null,
        text: m.content,
        createdAt: m.createdAt,
      }));
    }
    const res = await fetch(`/api/clubs/${clubId}/chat?limit=${RAIL_CHAT_MESSAGES}`, { cache: "no-store" });
    const data = (await res.json()) as { messages?: ClubMsg[] };
    return (data.messages ?? []).map(clubToThread);
  }, [chat.kind, clubId]);

  const send = useCallback(
    async (text: string): Promise<ThreadMessage | string | null> => {
      const url = chat.kind === "match" ? "/api/lobby/chat" : `/api/clubs/${clubId}/chat`;
      const body = chat.kind === "match" ? { content: text } : { message: text };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || "Could not send";
      return chat.kind === "club" && data.message ? clubToThread(data.message as ClubMsg) : null;
    },
    [chat.kind, clubId]
  );

  const thread = usePolledChat({
    key: chat.kind === "match" ? "match" : `club-${clubId}`,
    visible: true,
    load,
    send,
  });

  return (
    <ChatThread
      messages={thread.messages}
      me={me}
      onSend={thread.send}
      placeholder={chat.kind === "match" ? "Message your match…" : `Message ${chat.name}…`}
    />
  );
}
