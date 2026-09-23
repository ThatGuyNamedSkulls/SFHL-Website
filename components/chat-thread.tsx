"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronsRight, SendHorizontal, Trash2 } from "lucide-react";
import { OnlineBadge, useOnline } from "@/components/online-status";
import { RAIL_CHAT_MESSAGES, lastMessages as keepLast } from "@/lib/chat-limits";

const MAX_LENGTH = 250;
const POLL_MS = 3000;

/** One message, whatever chat it came from (party, match, club). */
export interface ThreadMessage {
  id: number;
  authorId: string;
  name: string;
  /** Player name for the profile link, when known. */
  profileName?: string | null;
  avatar?: string | null;
  text: string;
  createdAt: number;
}

/** Keep the newest `RAIL_CHAT_MESSAGES`, oldest first, without duplicates. */
export function lastMessages(rows: ThreadMessage[]): ThreadMessage[] {
  return keepLast(rows);
}

/**
 * Poll a chat while it's on screen, keeping only the last 10 messages.
 * `load` returns the latest messages; `send` posts one and may return the
 * saved message (or an error string).
 */
export function usePolledChat(opts: {
  key: string | null;
  visible: boolean;
  load: () => Promise<ThreadMessage[]>;
  send: (text: string) => Promise<ThreadMessage | string | null>;
}) {
  const { key, visible, load, send } = opts;
  const [state, setState] = useState<{ key: string | null; rows: ThreadMessage[] }>({
    key: null,
    rows: [],
  });
  const rows = state.key === key ? state.rows : [];

  const poll = useCallback(async () => {
    if (!key) return;
    try {
      const fresh = await load();
      setState({ key, rows: lastMessages(fresh) });
    } catch {
      /* next poll retries */
    }
  }, [key, load]);

  useEffect(() => {
    if (!key || !visible) return;
    const first = window.setTimeout(poll, 0);
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [key, visible, poll]);

  const post = useCallback(
    async (text: string): Promise<string | null> => {
      const result = await send(text);
      if (typeof result === "string") return result;
      if (result) {
        setState((prev) => ({
          key,
          rows: lastMessages([...(prev.key === key ? prev.rows : []), result]),
        }));
      } else {
        await poll();
      }
      return null;
    },
    [key, send, poll]
  );

  return { messages: rows, send: post };
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** FACEIT-style conversation: start marker, day dividers, safety notice,
 *  messages and the composer. Shows only the last 10 messages. */
export function ChatThread({
  messages,
  me,
  canDelete,
  onDelete,
  onSend,
  placeholder = "Type a message…",
  emptyHint,
}: {
  messages: ThreadMessage[];
  me: string | null;
  canDelete?: (m: ThreadMessage) => boolean;
  onDelete?: (id: number) => void;
  onSend: (text: string) => Promise<string | null>;
  placeholder?: string;
  emptyHint?: string;
}) {
  const shown = lastMessages(messages);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isOnline = useOnline({ ids: shown.map((m) => m.authorId) });
  const lastId = shown.length ? shown[shown.length - 1].id : 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

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

  // A "Today"-style divider before the first message of each day, plus one
  // for the safety notice when the conversation is empty.
  const items: React.ReactNode[] = [];
  let lastDay = "";
  shown.forEach((m) => {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      items.push(<DayDivider key={`d-${m.id}`} label={day} />);
      if (!lastDay) items.push(<SafetyNotice key="notice" />);
      lastDay = day;
    }
    const mine = m.authorId === me;
    items.push(
      <div key={m.id} className="group flex items-start gap-2.5 px-4 py-1.5 hover:bg-white/[0.02]">
        <OnlineBadge online={isOnline({ id: m.authorId })} size="xs" className="mt-0.5">
          {m.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.avatar} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <span className="w-7 h-7 rounded-full bg-[#2a2a2a] text-[9px] font-bold text-[#c8c8c8] flex items-center justify-center">
              {m.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </OnlineBadge>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {m.profileName ? (
              <Link
                href={`/profile?player=${encodeURIComponent(m.profileName)}`}
                className={`text-[12px] font-bold truncate hover:underline ${mine ? "text-[#ff5500]" : "text-white"}`}
              >
                {m.name}
              </Link>
            ) : (
              <span className={`text-[12px] font-bold truncate ${mine ? "text-[#ff5500]" : "text-white"}`}>
                {m.name}
              </span>
            )}
            <span className="text-[10px] text-[#6a6a6a] shrink-0">
              {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {onDelete && canDelete?.(m) ? (
              <button
                type="button"
                onClick={() => onDelete(m.id)}
                title="Delete message"
                aria-label="Delete message"
                className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-[#6a6a6a] hover:text-hl-red"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ) : null}
          </div>
          <p className="text-[13px] leading-snug text-[#d6d6d6] whitespace-pre-wrap break-words">{m.text}</p>
        </div>
      </div>
    );
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-3">
        <p className="text-center text-[10px] font-semibold tracking-[0.18em] uppercase text-[#6a6a6a] py-3">
          {shown.length >= RAIL_CHAT_MESSAGES
            ? `Last ${RAIL_CHAT_MESSAGES} messages`
            : "Beginning of conversation"}
        </p>
        {shown.length === 0 ? (
          <>
            <DayDivider label="Today" />
            <SafetyNotice />
            {emptyHint ? <p className="px-4 pt-2 text-xs text-[#8a8a8a]">{emptyHint}</p> : null}
          </>
        ) : (
          items
        )}
      </div>
      <form
        className="border-t border-white/[0.06] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#1f1f1f] pl-3 pr-1.5 focus-within:border-[#ff5500]/50">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-9 flex-1 min-w-0 bg-transparent text-[13px] text-white placeholder:text-[#6a6a6a] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 1}
            title="Send"
            aria-label="Send message"
            className="w-7 h-7 rounded-md flex items-center justify-center text-[#ff5500] hover:bg-white/5 disabled:text-[#555] disabled:hover:bg-transparent"
          >
            <SendHorizontal className="w-4 h-4" />
          </button>
        </div>
        {error ? <p className="pt-2 text-[11px] text-hl-red">{error}</p> : null}
      </form>
    </div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-[10px] font-semibold tracking-[0.16em] uppercase text-[#7a7a7a]">
      <span className="h-px flex-1 bg-white/[0.07]" />
      {label}
      <span className="h-px flex-1 bg-white/[0.07]" />
    </div>
  );
}

function SafetyNotice() {
  return (
    <div className="flex items-start gap-2 px-4 py-2 text-[13px] leading-snug text-[#cfcfcf]">
      <ChevronsRight className="w-3.5 h-3.5 mt-1 shrink-0 text-[#7a7a7a]" />
      <p>
        Beware of scams in chat: don&apos;t share login details or codes, and don&apos;t click
        unknown links. Report and block.
      </p>
    </div>
  );
}
