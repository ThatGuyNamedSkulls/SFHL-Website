"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lastMessages, type ThreadMessage } from "@/components/chat-thread";
import { RAIL_CHAT_MESSAGES } from "@/lib/chat-limits";

const OPEN_POLL_MS = 3000;
const CLOSED_POLL_MS = 12000;

interface PartyChatRow {
  id: number;
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  message: string;
  createdAt: number;
}

function toThread(r: PartyChatRow): ThreadMessage {
  return {
    id: r.id,
    authorId: r.discordId,
    name: r.playerName || r.username,
    profileName: r.playerName,
    avatar: r.avatar,
    text: r.message,
    createdAt: r.createdAt,
  };
}

/**
 * Party chat for the current party: the last 10 messages, polled quickly
 * while the chat is on screen and slowly otherwise so the rail can show an
 * unread count.
 */
export function usePartyChat(partyId: string | null, me: string | null, visible: boolean) {
  // Rows are tagged with their party, so switching parties starts fresh.
  const [chat, setChat] = useState<{ partyId: string | null; rows: ThreadMessage[]; seenId: number }>(
    { partyId: null, rows: [], seenId: 0 }
  );
  const rows = chat.partyId === partyId ? chat.rows : [];
  const latestId = rows.length ? rows[rows.length - 1].id : 0;
  const seenId = chat.partyId === partyId ? chat.seenId : 0;

  // Opening the chat marks everything in it as read.
  if (visible && partyId && chat.partyId === partyId && latestId > chat.seenId) {
    setChat({ ...chat, seenId: latestId });
  }

  const unread = visible ? 0 : rows.filter((m) => m.id > seenId && m.authorId !== me).length;

  const lastIdRef = useRef<{ partyId: string | null; id: number }>({ partyId: null, id: 0 });
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const merge = useCallback((forParty: string, incoming: ThreadMessage[], primed: boolean) => {
    setChat((prev) => {
      const base = prev.partyId === forParty ? prev : { partyId: forParty, rows: [], seenId: 0 };
      const rowsNext = lastMessages([...base.rows, ...incoming]);
      const last = rowsNext.length ? rowsNext[rowsNext.length - 1].id : 0;
      // History from the first load, and anything arriving while the chat is
      // open, counts as read.
      const seen = !primed || visibleRef.current ? last : base.seenId;
      return { partyId: forParty, rows: rowsNext, seenId: seen };
    });
    const top = incoming.reduce((m, r) => Math.max(m, r.id), 0);
    const ref = lastIdRef.current;
    lastIdRef.current = {
      partyId: forParty,
      id: ref.partyId === forParty ? Math.max(ref.id, top) : top,
    };
  }, []);

  const poll = useCallback(async () => {
    if (!partyId) return;
    const ref = lastIdRef.current;
    const primed = ref.partyId === partyId;
    const after = primed ? ref.id : 0;
    try {
      const res = await fetch(
        `/api/parties/${partyId}/chat?after=${after}&limit=${RAIL_CHAT_MESSAGES}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: PartyChatRow[] };
      merge(partyId, (Array.isArray(data.messages) ? data.messages : []).map(toThread), primed);
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
        if (data.message) merge(partyId, [toThread(data.message as PartyChatRow)], true);
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
