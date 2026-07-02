"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, UserPlus, Users, Check, X } from "lucide-react";

interface NotificationView {
  id: number;
  type: string;
  message: string;
  actorId: string | null;
  refId: string | null;
  read: boolean;
  createdAt: number;
}

/** Sidebar notifications bell: unread badge + dropdown with inline actions for
 *  friend requests and party invites. */
export function NotificationsBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      try {
        await fetch("/api/notifications", { method: "POST" });
      } catch {
        /* ignore */
      }
    }
  };

  const acceptFriend = async (n: NotificationView) => {
    if (!n.actorId) return;
    setBusy(n.id);
    try {
      await fetch("/api/friends/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: n.actorId }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const rejectFriend = async (n: NotificationView) => {
    if (!n.actorId) return;
    setBusy(n.id);
    try {
      await fetch("/api/friends/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: n.actorId }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const joinParty = async (n: NotificationView) => {
    if (!n.refId) return;
    setBusy(n.id);
    try {
      const res = await fetch(`/api/parties/${n.refId}/join`, { method: "POST" });
      if (res.ok) {
        setOpen(false);
        router.push("/party-finder");
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="hl-nav-item flex items-center gap-4 h-11 px-4 rounded-md mx-1 w-[calc(100%-8px)] text-hl-muted hover:text-white hover:bg-hl-panel-light/40"
        title="Notifications"
      >
        <span className="relative shrink-0">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-hl-red text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        <span className="text-sm font-semibold whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150">
          Alerts
        </span>
      </button>

      {open && (
        <div className="absolute left-full bottom-0 ml-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-hl-border bg-hl-panel shadow-2xl z-50">
          <div className="px-4 py-3 border-b border-hl-border">
            <span className="text-sm font-bold text-white header-caps">Notifications</span>
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-hl-muted">Nothing new right now.</div>
          ) : (
            <div className="divide-y divide-hl-border">
              {items.map((n) => (
                <div key={n.id} className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    {n.type === "party_invite" ? (
                      <Users className="w-4 h-4 text-hl-gold shrink-0 mt-0.5" />
                    ) : (
                      <UserPlus className="w-4 h-4 text-hl-teal shrink-0 mt-0.5" />
                    )}
                    <p className="text-sm text-white leading-snug">{n.message}</p>
                  </div>
                  {n.type === "friend_request" && n.actorId && (
                    <div className="flex gap-2 pl-6">
                      <button
                        onClick={() => acceptFriend(n)}
                        disabled={busy === n.id}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-hl-green/15 text-hl-green border border-hl-green/30 hover:bg-hl-green/25 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" /> Accept
                      </button>
                      <button
                        onClick={() => rejectFriend(n)}
                        disabled={busy === n.id}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" /> Decline
                      </button>
                    </div>
                  )}
                  {n.type === "party_invite" && n.refId && (
                    <div className="flex gap-2 pl-6">
                      <button
                        onClick={() => joinParty(n)}
                        disabled={busy === n.id}
                        className="text-xs font-bold px-4 py-1.5 rounded-md bg-gold-gradient text-hl-base hover:opacity-90 disabled:opacity-50"
                      >
                        Join party
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
