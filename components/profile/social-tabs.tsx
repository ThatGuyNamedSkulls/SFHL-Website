"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Trophy, UserPlus, Users, UsersRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ClubMark } from "@/components/club-identity";
import { EmptyState } from "@/components/empty-state";
import { Flag } from "@/components/flag";
import { RankBadge } from "@/components/rank-badge";
import { useSession } from "@/components/session-provider";
import { countryName, flagPath } from "@/lib/countries";
import { formatUsername } from "@/lib/format";
import { profileHref } from "@/lib/profile-link";
import type { RankTierLetter } from "@/types";
import type { ProfileClan, ProfileFriend, ProfileTeam } from "@/components/profile/types";

export function FriendsTab({
  friends,
  myName,
  onAddFriend,
}: {
  friends: ProfileFriend[];
  myName: string | null;
  /** Sends the request; resolves to the message to show. */
  onAddFriend: (name: string) => Promise<string>;
}) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-[#2a2a2a] px-3 py-1 text-xs font-bold text-white">
          All ({friends.length})
        </span>
        {note ? <span className="text-xs text-[#ff5500]">{note}</span> : null}
      </div>
      {friends.length === 0 ? (
        <EmptyState icon={Users} title="No friends yet" hint="Friends added on HyperLeague will show up here." />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {friends.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-[#1c1c1c] px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <Link href={profileHref(f.name)} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar className="h-9 w-9">
                  {f.avatar ? <AvatarImage src={f.avatar} /> : null}
                  <AvatarFallback className="bg-[#2a2a2a] text-[0.75rem] font-bold text-white">
                    {(f.name || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm font-semibold text-white">{formatUsername(f.name, f.discordUsername)}</span>
                {f.country ? <Flag src={flagPath(f.country)} name={countryName(f.country)} className="h-3 w-4 shrink-0" /> : null}
              </Link>
              <RankBadge rank={(f.rank || "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-6 !w-6" />
              {myName && f.name !== myName ? (
                <button
                  type="button"
                  onClick={() => void onAddFriend(f.name).then(setNote)}
                  title={`Add ${f.name} as a friend`}
                  aria-label={`Add ${f.name} as a friend`}
                  className="rounded-md p-1.5 text-[#8a8a8a] hover:text-[#ff5500]"
                >
                  <UserPlus className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface GuestbookEntry {
  id: number;
  fromName: string;
  message: string;
  createdAt: number;
  rank?: string;
}

export function GuestbookTab({ profileName }: { profileName: string }) {
  const { session } = useSession();
  const me = (session?.playerName || "").toLowerCase();
  const ownProfile = !!me && me === profileName.toLowerCase();
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/guestbook?player=${encodeURIComponent(profileName)}`)
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => setEntries([]));
  }, [profileName]);

  const post = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName: profileName, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to post");
      } else if (data.entry) {
        setEntries((prev) => [data.entry, ...prev]);
        setMessage("");
      }
    } catch {
      setError("Failed to post");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setError(null);
    const res = await fetch(`/api/guestbook?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to delete");
      return;
    }
    setEntries((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="space-y-4">
      {session?.playerName ? (
        <Card className="border-hl-border bg-hl-panel p-4">
          <div className="mb-2 text-xs text-hl-muted header-caps">Write a message</div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 250))}
            rows={3}
            placeholder="Say something…"
            className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted focus:border-hl-gold/50 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[0.75rem] text-hl-muted">{message.length}/250</span>
            <button
              type="button"
              onClick={post}
              disabled={busy || !message.trim()}
              className="rounded-md bg-gold-gradient px-4 py-1.5 text-xs font-black text-hl-base header-caps disabled:opacity-50"
            >
              {busy ? "Posting…" : "Post"}
            </button>
          </div>
          {error ? <p className="mt-2 text-xs text-hl-red">{error}</p> : null}
        </Card>
      ) : null}
      {entries.length === 0 ? (
        <div className="py-16 text-center">
          <h3 className="text-lg font-semibold text-white">The guestbook is empty</h3>
          <p className="mt-1 text-sm text-[#8a8a8a]">Be the first to leave a message.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <Card key={e.id} className="border-hl-border bg-hl-panel px-4 py-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Link href={profileHref(e.fromName)} className="flex min-w-0 items-center gap-2 text-sm font-bold text-white hover:text-hl-gold">
                  <RankBadge rank={(e.rank || "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5 shrink-0" />
                  <span className="truncate">{e.fromName}</span>
                </Link>
                <span className="flex items-center gap-2 text-[0.75rem] text-hl-muted">
                  {new Date(e.createdAt).toLocaleDateString()}
                  {ownProfile || e.fromName.toLowerCase() === me ? (
                    <button type="button" onClick={() => void remove(e.id)} className="text-hl-muted hover:text-hl-red" title="Delete message">
                      Delete
                    </button>
                  ) : null}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-hl-muted">{e.message}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClansTab({ clans, loaded }: { clans: ProfileClan[]; loaded: boolean }) {
  if (!loaded) return <p className="text-sm text-hl-muted">Loading clans…</p>;
  if (clans.length === 0) {
    return (
      <EmptyState icon={Building2} title="No clans" hint="This player hasn't joined a clan yet.">
        <Link href="/clans" className="text-sm font-bold text-hl-gold hover:underline">
          Browse clans
        </Link>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      {clans.map((club) => (
        <Link
          key={club.id}
          href={`/clans/${club.id}`}
          className="block rounded-xl border border-hl-border bg-hl-panel px-4 py-3 transition-colors hover:border-hl-gold/40"
        >
          <div className="flex items-center gap-3">
            <ClubMark tag={club.tag} accentColor={club.accentColor} logoUrl={club.logoUrl} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <div className="truncate text-sm font-bold text-white">{club.name}</div>
                <span className="shrink-0 text-xs font-bold text-hl-gold">[{club.tag}]</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-hl-muted">{club.description || "No description yet."}</p>
            </div>
            <span className="shrink-0 text-[0.75rem] text-hl-muted">
              {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { captain: "Captain", starter: "Starter", sub: "Substitute", coach: "Coach" };

/** The player's teams (docs/PROFILE_UI_PLAN.md §4.10) — used to say "Coming soon". */
export function TeamsTab({ teams }: { teams: ProfileTeam[] }) {
  if (teams.length === 0) {
    return (
      <EmptyState icon={UsersRound} title="No teams" hint="This player isn't on a team yet.">
        <Link href="/teams" className="text-sm font-bold text-hl-gold hover:underline">
          Browse teams
        </Link>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      {teams.map((team) => (
        <Link
          key={team.id}
          href={`/teams/${team.id}`}
          className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-white/[0.08] bg-[#1c1c1c] px-4 py-3.5 transition-colors hover:border-hl-gold/40"
        >
          <ClubMark tag={team.tag} accentColor={team.accentColor} logoUrl={team.logoUrl} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[0.9375rem] font-bold text-white">{team.name}</span>
              <span className="text-xs font-bold text-hl-gold">[{team.tag}]</span>
              <span className="rounded-md border border-hl-gold/40 px-1.5 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-[0.08em] text-hl-gold">
                {ROLE_LABEL[team.role] ?? team.role}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[#8a8a8a]">
              <span>{team.region}</span>
              <span>·</span>
              <span>
                {team.memberCount}/{team.maxMembers} players
              </span>
              {team.titles > 0 ? (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-[#ffc44d]">
                    <Trophy className="h-3 w-3" /> {team.titles} {team.titles === 1 ? "title" : "titles"}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex -space-x-2">
            {team.roster.map((m) => (
              <Avatar key={m.name} className="h-8 w-8 ring-2 ring-[#1c1c1c]">
                {m.avatar ? <AvatarImage src={m.avatar} alt={m.name} /> : null}
                <AvatarFallback className="bg-[#2a2a2a] text-[0.625rem] font-bold text-white">
                  {(m.name || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        </Link>
      ))}
    </div>
  );
}
