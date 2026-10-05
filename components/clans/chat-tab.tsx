"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Lock, Send, Trash2 } from "lucide-react";
import { useClan } from "@/components/clans/clan-context";
import { BTN_PRIMARY, BoxHead, INPUT, PANEL, PlayerAvatar } from "@/components/clans/ui";
import { startPolling } from "@/lib/poll-gate";
import { dayLabel, localDayKey } from "@/lib/profile-stats";
import { profileHref } from "@/lib/profile-link";

interface ChatRow {
  id: number;
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  message: string;
  createdAt: number;
}

/** Messages from the same person within this long share one header. */
const GROUP_MS = 5 * 60_000;

/**
 * Chat (§4.13): members only, refreshed every 4 s while open. Day separators,
 * one header per run of messages from the same person.
 */
export function ChatTab({ invite }: { invite: string }) {
  const { data, me, perms, now, act, busy, isOnline } = useClan();
  const club = data.club;
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clubs/${club.id}/chat`);
      const body = await res.json();
      if (res.ok) setMessages(Array.isArray(body.messages) ? body.messages : []);
    } catch {
      /* keep what we have */
    }
  }, [club.id]);

  useEffect(() => {
    if (!perms.member) return;
    return startPolling(load, 4000);
  }, [load, perms.member]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const groups = useMemo(() => {
    const out: { day: string; label: string; runs: { first: ChatRow; rows: ChatRow[] }[] }[] = [];
    for (const m of messages) {
      const key = localDayKey(m.createdAt);
      let day = out[out.length - 1];
      if (!day || day.day !== key) { 
        day = { day: key, label: dayLabel(m.createdAt, now), runs: [] };
        out.push(day);
      }
      const run = day.runs[day.runs.length - 1];
      const last = run?.rows[run.rows.length - 1];
      if (run && last && last.discordId === m.discordId && m.createdAt - last.createdAt < GROUP_MS) run.rows.push(m);
      else day.runs.push({ first: m, rows: [m] });
    }
    return out;
  }, [messages, now]);

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${club.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Couldn't send.");
        return;
      }
      setText("");
      if (body.message) setMessages((prev) => [...prev, body.message]);
      else await load();
    } catch {
      setError("Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/clubs/${club.id}/chat?id=${id}`, { method: "DELETE" });
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  if (!perms.member) {
    return (
      <section className={`${PANEL} flex min-h-[26rem] flex-col`}>
        <BoxHead title="Clan chat">Members only</BoxHead>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <Lock className="mb-1 h-[1.375rem] w-[1.375rem] text-[#8a8a8a]" />
          <b className="font-semibold text-[#ededed]">Only members can read the clan chat</b>
          <p className="max-w-[21rem] text-[0.8125rem] text-[#8a8a8a]">
            {!me
              ? "Log in and join the clan to read it."
              : club.private && !invite
                ? "This clan is invite only. Send a request and the staff will answer it."
                : "Join the clan to read and send messages."}
          </p>
          {!me ? (
            <Link href="/login" className={`${BTN_PRIMARY} mt-2`}>
              Log in
            </Link>
          ) : club.private && !invite ? (
            club.requested ? null : (
              <button type="button" className={`${BTN_PRIMARY} mt-2`} disabled={busy} onClick={() => void act(`/api/clubs/${club.id}/join-request`)}>
                Request to join
              </button>
            )
          ) : (
            <button type="button" className={`${BTN_PRIMARY} mt-2`} disabled={busy} onClick={() => void act(`/api/clubs/${club.id}/join`, "POST", { invite })}>
              Join clan
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`${PANEL} flex h-[calc(100dvh-19rem)] min-h-[26rem] flex-col md:h-[35rem]`}>
      <BoxHead title="Clan chat">{club.members.filter((m) => isOnline({ name: m.playerName || m.username })).length} online</BoxHead>
      <div className="flex-1 overflow-y-auto px-4 pb-3.5 pt-1.5">
        {groups.length === 0 ? <p className="py-6 text-sm text-[#8a8a8a]">No messages yet. Say hi.</p> : null}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="my-3.5 flex items-center gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[#666] before:flex-1 before:border-t before:border-white/[0.07] after:flex-1 after:border-t after:border-white/[0.07]">
              {g.label}
            </div>
            {g.runs.map(({ first, rows }) => {
              const name = first.playerName || first.username;
              return (
                <div key={first.id} className="group grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 py-1.5">
                  <PlayerAvatar name={name} src={first.avatar} size={32} online={isOnline({ name })} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      {first.playerName ? (
                        <Link href={profileHref(first.playerName)} className="truncate font-semibold text-[#ededed] hover:text-white">
                          {name}
                        </Link>
                      ) : (
                        <b className="truncate font-semibold text-[#ededed]">{name}</b>
                      )}
                      <small className="shrink-0 text-[0.6875rem] text-[#666]">
                        {new Date(first.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </small>
                    </div>
                    {rows.map((m) => (
                      <div key={m.id} className="group/msg flex items-start gap-2">
                        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-[#d6d6d6]">{m.message}</p>
                        {perms.owner || m.discordId === me ? (
                          <button
                            type="button"
                            onClick={() => void remove(m.id)}
                            className="mt-0.5 shrink-0 text-[#666] opacity-0 hover:text-[#f08a7f] focus:opacity-100 group-hover/msg:opacity-100"
                            aria-label="Delete message"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex gap-2 border-t border-white/[0.07] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className={INPUT}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 250))}
          placeholder={`Message ${club.name}`}
          aria-label="Message"
        />
        <button type="submit" className={BTN_PRIMARY} disabled={sending || !text.trim()}>
          <Send className="h-4 w-4" /> <span className="hidden sm:inline">Send</span>
        </button>
      </form>
      {error ? <p className="px-3 pb-3 text-xs text-[#f08a7f]">{error}</p> : null}
    </section>
  );
}
