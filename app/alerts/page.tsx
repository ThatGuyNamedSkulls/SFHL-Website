"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { UserSession } from "@/types";
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

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AlertsPage() {
  const router = useRouter();
  const [session, setSession] = useState<UserSession | null | undefined>(undefined);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user ?? null))
      .catch(() => setSession(null));
    load();
    // Mark everything read when the page opens.
    fetch("/api/notifications", { method: "POST" }).catch(() => {});
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const post = (url: string, body: object) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const acceptFriend = async (n: NotificationView) => {
    if (!n.actorId) return;
    setBusy(n.id);
    try {
      await post("/api/friends/accept", { fromName: n.actorId });
      await load();
    } finally {
      setBusy(null);
    }
  };
  const rejectFriend = async (n: NotificationView) => {
    if (!n.actorId) return;
    setBusy(n.id);
    try {
      await post("/api/friends/reject", { fromName: n.actorId });
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
      if (res.ok) router.push("/party-finder");
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (session === null) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader icon={Bell} title="Alerts" subtitle="Friend requests, party invites and updates" />
        <EmptyState icon={Bell} title="Log in to see your alerts" hint="Sign in with Discord to get notifications." />
        <div className="mt-4">
          <Link href="/login" className="inline-flex px-5 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm">Log in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader icon={Bell} title="Alerts" subtitle="Friend requests, party invites and updates" />

      {items.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing new" hint="Friend requests and party invites will show up here." />
      ) : (
        <div className="rounded-xl border border-hl-border bg-hl-panel divide-y divide-hl-border overflow-hidden">
          {items.map((n) => (
            <div key={n.id} className="px-5 py-4 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                {n.type === "party_invite" ? (
                  <Users className="w-5 h-5 text-hl-gold shrink-0 mt-0.5" />
                ) : (
                  <UserPlus className="w-5 h-5 text-hl-teal shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white leading-snug">{n.message}</p>
                  <span className="text-[11px] text-hl-muted">{timeAgo(n.createdAt)}</span>
                </div>
              </div>
              {n.type === "friend_request" && n.actorId && (
                <div className="flex gap-2 pl-8">
                  <button onClick={() => acceptFriend(n)} disabled={busy === n.id} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-hl-green/15 text-hl-green border border-hl-green/30 hover:bg-hl-green/25 disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button onClick={() => rejectFriend(n)} disabled={busy === n.id} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20 disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> Decline
                  </button>
                </div>
              )}
              {n.type === "party_invite" && n.refId && (
                <div className="flex gap-2 pl-8">
                  <button onClick={() => joinParty(n)} disabled={busy === n.id} className="text-xs font-bold px-4 py-1.5 rounded-md bg-gold-gradient text-hl-base hover:opacity-90 disabled:opacity-50">
                    Join party
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
