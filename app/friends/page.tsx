"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserSession } from "@/types";
import { UserPlus, Users, Check, X, Search, UserMinus, Clock } from "lucide-react";

interface WebUser {
  discord_id: string;
  username: string | null;
  avatar: string | null;
  player_name: string | null;
}
interface RequestView {
  id: string;
  user: WebUser;
  createdAt: number;
}

const label = (u: WebUser) => u.player_name || u.username || "Unknown";

function UserRow({
  user,
  actions,
}: {
  user: WebUser;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-hl-panel-light/40 transition-colors">
      <Avatar className="w-9 h-9 border border-hl-border shrink-0">
        {user.avatar ? <AvatarImage src={user.avatar} /> : null}
        <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
          {label(user).slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        {user.player_name ? (
          <Link
            href={`/profile?player=${encodeURIComponent(user.player_name)}`}
            className="text-sm font-semibold text-white truncate hover:text-hl-gold"
          >
            {user.player_name}
          </Link>
        ) : (
          <span className="text-sm font-semibold text-white truncate">{label(user)}</span>
        )}
        {user.username && user.player_name && (
          <div className="text-[11px] text-hl-muted truncate">@{user.username}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </div>
  );
}

export default function FriendsPage() {
  const [session, setSession] = useState<UserSession | null | undefined>(undefined);
  const [friends, setFriends] = useState<WebUser[]>([]);
  const [incoming, setIncoming] = useState<RequestView[]>([]);
  const [outgoing, setOutgoing] = useState<RequestView[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WebUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/friends");
      if (!res.ok) return;
      const data = await res.json();
      setFriends(data.friends ?? []);
      setIncoming(data.incoming ?? []);
      setOutgoing(data.outgoing ?? []);
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
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Debounced user search.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults(data.users ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const sendRequest = async (toId: string) => {
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toId }),
    });
    const data = await res.json();
    if (!res.ok) flash(data.error || "Failed to send request");
    else if (data.status === "friends") flash("You're now friends!");
    else if (data.status === "exists") flash("Request already sent.");
    else flash("Friend request sent.");
    await load();
  };

  const accept = async (fromId: string) => {
    await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId }),
    });
    await load();
  };

  const reject = async (fromId: string) => {
    await fetch("/api/friends/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId }),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch("/api/friends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  };

  const outgoingIds = new Set(outgoing.map((r) => r.id));
  const friendIds = new Set(friends.map((f) => f.discord_id));

  if (session === null) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader icon={UserPlus} title="Friends" subtitle="Add friends and invite them to parties" />
        <EmptyState
          icon={UserPlus}
          title="Log in to manage friends"
          hint="Sign in with Discord to add friends and get party invites."
        />
        <div className="mt-4">
          <Link href="/login" className="inline-flex px-5 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm">
            Log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader icon={UserPlus} title="Friends" subtitle="Add friends and invite them to parties" />

      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-hl-gold/10 border border-hl-gold/30 text-hl-gold text-sm">
          {notice}
        </div>
      )}

      {/* Add friends */}
      <div className="mb-6">
        <div className="relative">
          <Search className="w-4 h-4 text-hl-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players by name to add…"
            className="w-full bg-hl-panel border border-hl-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-hl-gold/50"
          />
        </div>
        {query.trim().length >= 2 && (
          <div className="mt-2 rounded-lg border border-hl-border bg-hl-panel divide-y divide-hl-border overflow-hidden">
            {searching && results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-hl-muted">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-hl-muted">No players found.</div>
            ) : (
              results.map((u) => (
                <UserRow
                  key={u.discord_id}
                  user={u}
                  actions={
                    friendIds.has(u.discord_id) ? (
                      <span className="text-xs text-hl-muted">Friends</span>
                    ) : outgoingIds.has(u.discord_id) ? (
                      <span className="flex items-center gap-1 text-xs text-hl-muted"><Clock className="w-3.5 h-3.5" /> Pending</span>
                    ) : (
                      <button
                        onClick={() => sendRequest(u.discord_id)}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-gold-gradient text-hl-base hover:opacity-90"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Add
                      </button>
                    )
                  }
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-2">Requests ({incoming.length})</h2>
          <div className="rounded-lg border border-hl-border bg-hl-panel divide-y divide-hl-border overflow-hidden">
            {incoming.map((r) => (
              <UserRow
                key={r.id}
                user={r.user}
                actions={
                  <>
                    <button
                      onClick={() => accept(r.id)}
                      className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-hl-green/15 text-hl-green border border-hl-green/30 hover:bg-hl-green/25"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => reject(r.id)}
                      className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-hl-red/10 text-hl-red border border-hl-red/30 hover:bg-hl-red/20"
                    >
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Friends list */}
      <section className="mb-6">
        <h2 className="text-sm font-bold text-white header-caps mb-2 flex items-center gap-2">
          <Users className="w-4 h-4 text-hl-gold" /> Friends ({friends.length})
        </h2>
        {friends.length === 0 ? (
          <EmptyState icon={Users} title="No friends yet" hint="Search above to add your first friend." />
        ) : (
          <div className="rounded-lg border border-hl-border bg-hl-panel divide-y divide-hl-border overflow-hidden">
            {friends.map((f) => (
              <UserRow
                key={f.discord_id}
                user={f}
                actions={
                  <button
                    onClick={() => remove(f.discord_id)}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md border border-hl-border text-hl-muted hover:text-hl-red hover:border-hl-red/40"
                  >
                    <UserMinus className="w-3.5 h-3.5" /> Remove
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Outgoing */}
      {outgoing.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-white header-caps mb-2">Sent ({outgoing.length})</h2>
          <div className="rounded-lg border border-hl-border bg-hl-panel divide-y divide-hl-border overflow-hidden">
            {outgoing.map((r) => (
              <UserRow
                key={r.id}
                user={r.user}
                actions={<span className="flex items-center gap-1 text-xs text-hl-muted"><Clock className="w-3.5 h-3.5" /> Pending</span>}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
