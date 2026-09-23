"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, Trash2 } from "lucide-react";
import { OnlineBadge, useOnline } from "@/components/online-status";

const MAX_LENGTH = 250;
const OPEN_POLL_MS = 3000;
const CLOSED_POLL_MS = 12000;

export interface PartyChatRow {
  id: number;
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  message: string;
  createdAt: number;
}

/**
 * Party chat state for the current party. Polls only for messages newer than
 * the last one seen — quickly while the chat is visible, slowly otherwise so
 * the rail can show an unread count.
 */
export function usePartyChat(partyId: string | null, me: string | null, visible: boolean) {
  // Messages are tagged with their party, so switching parties shows a fresh
  // conversation without a reset effect.
  const [chat, setChat] = useState<{ partyId: string | null; rows: PartyChatRow[]; seenId: number }>(
    { partyId: null, rows: [], seenId: 0 }
  );
  const rows = chat.partyId === partyId ? chat.rows : [];
  const latestId = rows.length ? rows[rows.length - 1].id : 0;
  const seenId = chat.partyId === partyId ? chat.seenId : 0;

  // Opening the chat marks everything in it as read.
  if (visible && partyId && chat.partyId === partyId && latestId > chat.seenId) {
    setChat({ ...chat, seenId: latestId });
  }

  const unread = visible
    ? 0
    : rows.filter((m) => m.id > seenId && m.discordId !== me).length;

  const lastIdRef = useRef<{ partyId: string | null; id: number }>({ partyId: null, id: 0 });
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const merge = useCallback(
    (forParty: string, incoming: PartyChatRow[], primed: boolean) => {
      setChat((prev) => {
        const base = prev.partyId === forParty ? prev : { partyId: forParty, rows: [], seenId: 0 };
        const have = new Set(base.rows.map((m) => m.id));
        const rowsNext = [...base.rows, ...incoming.filter((m) => !have.has(m.id))].slice(-120);
        const last = rowsNext.length ? rowsNext[rowsNext.length - 1].id : 0;
        // History from the first load, and anything arriving while the chat
        // is open, counts as read.
        const seen = !primed || visibleRef.current ? last : base.seenId;
        return { partyId: forParty, rows: rowsNext, seenId: seen };
      });
      if (incoming.length) {
        const top = Math.max(...incoming.map((m) => m.id));
        const ref = lastIdRef.current;
        lastIdRef.current = {
          partyId: forParty,
          id: ref.partyId === forParty ? Math.max(ref.id, top) : top,
        };
      }
    },
    []
  );

  const poll = useCallback(async () => {
    if (!partyId) return;
    const ref = lastIdRef.current;
    const primed = ref.partyId === partyId;
    const after = primed ? ref.id : 0;
    try {
      const res = await fetch(`/api/parties/${partyId}/chat?after=${after}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: PartyChatRow[] };
      merge(partyId, Array.isArray(data.messages) ? data.messages : [], primed);
      if (!primed && lastIdRef.current.partyId !== partyId) {
        lastIdRef.current = { partyId, id: 0 };
      }
    } catch {
      /* ignore — next poll retries */
    }
  }, [partyId, merge]);

  useEffect(() => {
    if (!partyId) return;
    const first = window.setTimeout(poll, 0);
    const id = window.setInterval(poll, visible ? OPEN_POLL_MS : CLOSED_POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [partyId, visible, poll]);

  const send = useCallback(
    async (text: string): Promise<string | null> => {
      if (!partyId) return "You're not in a party.";
      try {
        const res = await fetch(`/api/parties/${partyId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.error || "Could not send";
        if (data.message) merge(partyId, [data.message as PartyChatRow], true);
        return null;
      } catch {
        return "Could not send";
      }
    },
    [partyId, merge]
  );

  const remove = useCallback(
    async (messageId: number) => {
      if (!partyId) return;
      const res = await fetch(`/api/parties/${partyId}/chat?id=${messageId}`, { method: "DELETE" });
      if (res.ok) {
        setChat((prev) => ({ ...prev, rows: prev.rows.filter((m) => m.id !== messageId) }));
      }
    },
    [partyId]
  );

  return { messages: rows, unread, send, remove };
}

/** Compact chat panel (used inside the My Party flyout). */
export function PartyChatPanel({
  messages,
  me,
  isLeader,
  onSend,
  onDelete,
}: {
  messages: PartyChatRow[];
  me: string;
  isLeader: boolean;
  onSend: (text: string) => Promise<string | null>;
  onDelete: (id: number) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isOnline = useOnline({ ids: messages.map((m) => m.discordId) });

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSend(message);
    if (err) setError(err);
    else setText("");
    setBusy(false);
  };

  return (
    <div className="border-t border-white/10">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-xs font-black text-white header-caps">
        <MessageSquare className="w-3.5 h-3.5 text-[#ff5500]" />
        Party chat
      </div>
      <div ref={listRef} className="max-h-[220px] min-h-[96px] overflow-y-auto px-3 space-y-2.5">
        {messages.length === 0 ? (
          <p className="px-1 py-3 text-xs text-[#8a8a8a]">No messages yet. Say hi to your party.</p>
        ) : (
          messages.map((row) => {
            const label = row.playerName || row.username;
            const mine = row.discordId === me;
            return (
              <div key={row.id} className="group flex items-start gap-2">
                <OnlineBadge online={isOnline({ id: row.discordId })} size="xs" className="mt-0.5">
                  {row.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.avatar} alt="" referrerPolicy="no-referrer" className="w-6 h-6 rounded-md object-cover" />
                  ) : (
                    <span className="w-6 h-6 rounded-md bg-[#1a1a1a] text-[8px] font-bold text-[#ff5500] flex items-center justify-center">
                      {label.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </OnlineBadge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    {row.playerName ? (
                      <Link
                        href={`/profile?player=${encodeURIComponent(row.playerName)}`}
                        className={`text-[11px] font-bold truncate hover:underline ${mine ? "text-[#ff5500]" : "text-white"}`}
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className={`text-[11px] font-bold truncate ${mine ? "text-[#ff5500]" : "text-white"}`}>{label}</span>
                    )}
                    <span className="text-[10px] text-[#6a6a6a] shrink-0">
                      {new Date(row.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {mine || isLeader ? (
                      <button
                        type="button"
                        onClick={() => onDelete(row.id)}
                        title="Delete message"
                        className="ml-auto opacity-0 group-hover:opacity-100 text-[#6a6a6a] hover:text-hl-red"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    ) : null}
                  </div>
                  <p className="text-xs text-[#d0d0d0] whitespace-pre-wrap break-words">{row.message}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          placeholder="Message your party…"
          className="h-8 flex-1 min-w-0 rounded-md border border-white/10 bg-[#111] px-2.5 text-xs text-white placeholder:text-[#6a6a6a] focus:outline-none focus:border-[#ff5500]/50"
        />
        <button
          type="submit"
          disabled={busy || text.trim().length < 1}
          className="h-8 rounded-md px-3 text-[11px] font-black header-caps bg-gold-gradient text-hl-base disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {error ? <p className="px-3 pb-3 -mt-1 text-[11px] text-hl-red">{error}</p> : null}
    </div>
  );
}
