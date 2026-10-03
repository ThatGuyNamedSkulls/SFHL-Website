"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, Link2, LogOut, MessageSquare, Share, Tag } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ClubMark } from "@/components/club-identity";
import { RankBadge } from "@/components/rank-badge";
import { useOnline } from "@/components/online-status";
import { useSession } from "@/components/session-provider";
import { useNow } from "@/components/use-now";
import { ClanContext, permsFor, type ClanContextValue } from "@/components/clans/clan-context";
import { BTN_LINE, BTN_PRIMARY, ConfirmDialog, JoiningChip, PANEL } from "@/components/clans/ui";
import { OverviewTab } from "@/components/clans/overview-tab";
import { MembersTab } from "@/components/clans/members-tab";
import { LeaderboardTab } from "@/components/clans/leaderboard-tab";
import { TournamentsTab } from "@/components/clans/tournaments-tab";
import { ChatTab } from "@/components/clans/chat-tab";
import { ManageTab } from "@/components/clans/manage-tab";
import type { ClanData } from "@/components/clans/types";
import { CLAN_TABS, clanHref, isClanTab, type ClanTab } from "@/lib/clan-ui";
import { regionMeta } from "@/lib/regions";
import type { RankTierLetter } from "@/types";

const TAB_LABELS: Record<ClanTab, string> = {
  overview: "Overview",
  members: "Members",
  leaderboard: "Leaderboard",
  tournaments: "Tournaments",
  chat: "Chat",
  manage: "Manage",
};

export function ClanSkeleton() {
  return (
    <div className="hl-page-wide max-w-[73.75rem] space-y-5">
      <Skeleton className="h-24 w-full max-w-[32rem] rounded-xl" />
      <Skeleton className="h-[5.5rem] w-full rounded-[0.625rem]" />
      <Skeleton className="h-9 w-[28rem] max-w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-[0.625rem]" />
    </div>
  );
}

/** The open tab, in the URL (?tab=members) like the profile; Overview by default (Q1). */
function useClanTab(): [ClanTab, (tab: ClanTab) => void] {
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: ClanTab = isClanTab(raw) ? raw : "overview";
  const setTab = useCallback(
    (next: ClanTab) => {
      if (next === tab) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      window.history.pushState(null, "", query ? `?${query}` : window.location.pathname);
    },
    [searchParams, tab]
  );
  return [tab, setTab];
}

/** Read the "last opened" mark for a clan's chat, then move it to now. */
function takeSeen(clubId: string): number {
  try {
    const key = `hl-club-seen:${clubId}`;
    const before = Number(window.localStorage.getItem(key) || 0);
    window.localStorage.setItem(key, String(Date.now()));
    return before;
  } catch {
    return Date.now();
  }
}

/**
 * A clan's page (docs/CLANS_UI_PLAN.md): the header with the clan color, the
 * four stats and the action, then Overview · Members · Leaderboard ·
 * Tournaments · Chat · Manage. `/clans/<id>` and `/clans/<TAG>` both open it.
 */
export function ClanView({ idOrTag }: { idOrTag: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite") || "";
  const { session, loaded, refresh } = useSession();
  const me = session?.discordId ?? null;
  const now = useNow(false);
  const [tab, setTab] = useClanTab();
  const [data, setData] = useState<ClanData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTagClub, setActiveTagClub] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const seenRef = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/clubs/${encodeURIComponent(idOrTag)}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const body = (await res.json()) as ClanData;
        if (!cancelled && body.club) setData(body);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [idOrTag, me]);

  const clubId = data?.club.id ?? null;
  const isMember = !!(data && me && data.club.members.some((m) => m.discordId === me));

  // Unread chat for the tab badge: messages since the clan was last opened.
  useEffect(() => {
    if (!clubId || !isMember) return;
    // Taken once per clan: the mark moves to now as soon as the page opens.
    if (seenRef.current?.id !== clubId) seenRef.current = { id: clubId, at: takeSeen(clubId) };
    const seen = seenRef.current.at;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/clubs/${clubId}/chat?limit=50`);
        const body = (await res.json()) as { messages?: { discordId: string; createdAt: number }[] };
        if (!cancelled) setUnread((body.messages ?? []).filter((m) => m.createdAt > seen && m.discordId !== me).length);
      } catch {
        /* no badge */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [clubId, isMember, me]);

  useEffect(() => {
    if (!me || !isMember) return;
    let cancelled = false;
    fetch("/api/clubs/tag")
      .then((r) => r.json())
      .then((d) => !cancelled && setActiveTagClub(typeof d.activeClubId === "string" ? d.activeClubId : null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me, isMember]);

  const act = useCallback(
    async (path: string, method = "POST", body?: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(path, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof out.error === "string" ? out.error : "Something went wrong.");
          return false;
        }
        if (out.club) setData(out as ClanData);
        else if (out.ok) router.push("/clans");
        return true;
      } catch {
        setError("Something went wrong.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  const notify = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 2500);
  }, []);

  const names = useMemo(() => (data ? data.club.members.map((m) => m.playerName || m.username) : []), [data]);
  const isOnline = useOnline({ names });

  const ctx: ClanContextValue | null = useMemo(() => {
    if (!data) return null;
    return {
      data,
      me,
      myMember: me ? data.club.members.find((m) => m.discordId === me) ?? null : null,
      perms: permsFor(data, me),
      now,
      busy,
      isOnline,
      act,
      notify,
    };
  }, [data, me, now, busy, isOnline, act, notify]);

  if (notFound) {
    return (
      <div className="hl-page-wide py-16 text-center">
        <h1 className="mb-3 text-2xl font-bold text-white">Clan not found</h1>
        <p className="mb-6 text-sm text-[#8a8a8a]">It may have been deleted, or the link is wrong.</p>
        <Link href="/clans" className="font-semibold text-[#ff5500] hover:underline">
          Browse clans
        </Link>
      </div>
    );
  }
  if (!data || !ctx) return <ClanSkeleton />;

  const club = data.club;
  const { perms } = ctx;
  const stats = data.stats;
  const winRate = stats.together ? Math.round((stats.togetherWins / stats.together) * 100) : null;
  const light = ["#f5f5f5", "#f1c40f", "#c4b5fd"].includes(club.accentColor);
  const tabs = CLAN_TABS.filter((t) => t !== "manage" || perms.staff);
  const shown: ClanTab = tabs.includes(tab) ? tab : "overview";
  const myRoleName = ctx.myMember ? club.roles.find((r) => r.id === ctx.myMember!.role)?.name ?? "Member" : null;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${clanHref(club.tag)}` : clanHref(club.tag);

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(done);
    } catch {
      notify("Couldn't copy the link");
    }
  };

  const showMyTag = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/clubs/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubId: club.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof out.error === "string" ? out.error : "Couldn't change your tag.");
        return;
      }
      setActiveTagClub(club.id);
      notify(`Your name now shows as [${club.tag}] ${session?.playerName ?? ""}`.trim());
      await refresh({ force: true });
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    const token = club.invites[0]?.token;
    if (token) return copy(`${window.location.origin}${clanHref(club.tag)}?invite=${token}`, "Invite link copied");
    // No link yet: make one, then copy it.
    const res = await fetch(`/api/clubs/${club.id}/invite`, { method: "POST" });
    const out = (await res.json().catch(() => ({}))) as ClanData & { error?: string };
    if (!res.ok || !out.club) return setError(out.error || "Couldn't make an invite link.");
    setData(out);
    const fresh = out.club.invites[0]?.token;
    if (fresh) await copy(`${window.location.origin}${clanHref(club.tag)}?invite=${fresh}`, "Invite link copied");
  };

  let action: React.ReactNode;
  if (!loaded) action = null;
  else if (!session) {
    action = (
      <Link href="/login" className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
        Log in to join
      </Link>
    );
  } else if (!perms.member) {
    action =
      club.private && !invite ? (
        club.requested ? (
          <button
            type="button"
            className={`${BTN_LINE} flex-1 sm:flex-none`}
            disabled={busy}
            onClick={() => void act(`/api/clubs/${club.id}/join-request`, "DELETE")}
            title="Cancel your request"
          >
            <Check className="h-4 w-4" /> Request sent
          </button>
        ) : (
          <button
            type="button"
            className={`${BTN_PRIMARY} flex-1 sm:flex-none`}
            disabled={busy}
            onClick={() => void act(`/api/clubs/${club.id}/join-request`)}
          >
            Request to join
          </button>
        )
      ) : (
        <button
          type="button"
          className={`${BTN_PRIMARY} flex-1 sm:flex-none`}
          disabled={busy}
          onClick={() => void act(`/api/clubs/${club.id}/join`, "POST", { invite })}
        >
          {club.private ? "Join with invite" : "Join clan"}
        </button>
      );
  } else {
    action = (
      <DropdownMenu>
        <DropdownMenuTrigger className={`${BTN_LINE} flex-1 outline-none sm:flex-none`}>
          {myRoleName} <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 border border-white/10 bg-[#1e1e1e] p-1 text-[#ededed]">
          <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2" disabled={activeTagClub === club.id} onClick={() => void showMyTag()}>
            <Tag className="h-4 w-4 text-[#8a8a8a]" />
            {activeTagClub === club.id ? `Showing [${club.tag}] before your name` : `Show [${club.tag}] before my name`}
          </DropdownMenuItem>
          {perms.invite ? (
            <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2" onClick={() => void copyInvite()}>
              <Link2 className="h-4 w-4 text-[#8a8a8a]" /> Copy invite link
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2" onClick={() => setTab("chat")}>
            <MessageSquare className="h-4 w-4 text-[#8a8a8a]" /> Open clan chat
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/[0.07]" />
          {perms.owner ? (
            <p className="px-2.5 py-1.5 text-xs leading-snug text-[#8a8a8a]">To leave, transfer the clan first (Manage, Danger zone).</p>
          ) : (
            <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2 text-[#f08a7f]" onClick={() => setConfirmLeave(true)}>
              <LogOut className="h-4 w-4" /> Leave clan
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <ClanContext.Provider value={ctx}>
      <div className="relative min-h-full">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[17rem] md:h-[17rem]"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${club.accentColor} ${light ? 12 : 24}%, #161616) 0%, #161616 100%)`,
          }}
        />
        <div className="hl-page-wide relative max-w-[73.75rem] space-y-5">
          <Link href="/clans" className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[#8a8a8a] hover:text-white">
            <ChevronLeft className="h-4 w-4" /> Clans
          </Link>

          <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-5">
            <div className="overflow-hidden rounded-xl border border-white/[0.12] shadow-[0_10px_28px_rgba(0,0,0,0.4)] md:rounded-2xl">
              <ClubMark
                tag={club.tag}
                accentColor={club.accentColor}
                logoUrl={club.logoUrl}
                size={96}
                className="!h-16 !w-16 !rounded-none md:!h-24 md:!w-24"
              />
            </div>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[1.375rem] font-bold tracking-[-0.015em] text-[#ededed] md:text-[1.75rem]">
                {club.name}
                <span className="relative -top-1 rounded-md border border-[#ff5500]/35 bg-[#ff5500]/[0.08] px-[0.4375rem] py-0.5 text-xs font-bold tracking-[0.08em] text-[#ff5500] md:text-[0.8125rem]">
                  {club.tag}
                </span>
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-y-1 text-[0.8125rem] text-[#bdbdbd]">
                <JoiningChip isPrivate={club.private} className="mr-2.5" />
                {regionMeta(club.region).label}
                <span className="hidden items-center md:inline-flex">
                  <span className="mx-[0.4375rem] text-[#4a4a4a]">·</span>
                  Owned by <b className="ml-1 font-semibold text-[#ededed]">{club.ownerName}</b>
                  <span className="mx-[0.4375rem] text-[#4a4a4a]">·</span>
                  Since {new Date(club.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </span>
              </div>
            </div>
            <div className="col-span-2 flex items-center gap-2 md:col-span-1">
              {action}
              <button
                type="button"
                className={`${BTN_LINE} !w-9 !px-0`}
                title={`Copy link · ${shareUrl.replace(/^https?:\/\//, "")}`}
                aria-label="Copy the clan's link"
                onClick={() => void copy(shareUrl, "Clan link copied")}
              >
                <Share className="h-4 w-4" />
              </button>
            </div>
          </section>

          {error || message ? (
            <div
              className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-[0.8125rem] ${
                error ? "border-[#e74c3c]/35 bg-[#e74c3c]/10 text-[#f5b1aa]" : "border-white/10 bg-[#1c1c1c] text-[#ededed]"
              }`}
              role={error ? "alert" : "status"}
            >
              <span>{error ?? message}</span>
              {error ? (
                <button type="button" className="text-xs font-semibold text-[#f5b1aa] hover:text-white" onClick={() => setError(null)}>
                  Dismiss
                </button>
              ) : null}
            </div>
          ) : null}

          <section className={`${PANEL} grid grid-cols-2 md:grid-cols-4`}>
            {[
              {
                label: "Members",
                value: stats.members,
                sub: `${stats.ranked} ranked · ${club.members.filter((m) => isOnline({ name: m.playerName || m.username })).length} online`,
              },
              {
                label: "Average Elo",
                value: stats.avgElo ? (
                  <span className="flex items-center gap-2">
                    <RankBadge rank={stats.avgRank as RankTierLetter} size="sm" showGlow={false} className="!h-6 !w-6" />
                    {stats.avgElo.toLocaleString()}
                  </span>
                ) : (
                  "—"
                ),
                sub: stats.avgElo ? `Ranked members · ${stats.avgRank}` : "No ranked members",
              },
              { label: "Matches together", value: stats.together, sub: data.season.startedAt ? "This season" : "All time" },
              {
                label: "Win rate together",
                value:
                  winRate == null ? (
                    "—"
                  ) : (
                    <span className={winRate >= 50 ? "text-[#2ecc71]" : "text-[#e74c3c]"}>{winRate}%</span>
                  ),
                sub: stats.together ? `${stats.togetherWins} W · ${stats.together - stats.togetherWins} L` : "No matches yet",
              },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`min-w-0 px-3.5 py-3 md:px-[1.125rem] md:py-3.5 ${i % 2 ? "border-l border-white/[0.07]" : ""} ${
                  i >= 2 ? "border-t border-white/[0.07] md:border-t-0" : ""
                } ${i === 2 ? "md:border-l" : ""}`}
              >
                <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[#8a8a8a]">{s.label}</div>
                <div className="mt-1.5 text-[1.1875rem] font-bold tabular-nums text-[#ededed] md:text-[1.375rem]">{s.value}</div>
                <div className="mt-0.5 truncate text-xs text-[#8a8a8a]">{s.sub}</div>
              </div>
            ))}
          </section>

          <nav
            aria-label="Clan sections"
            className="sticky top-0 z-20 -mx-4 flex gap-5 overflow-x-auto border-b border-white/[0.07] bg-[#161616] px-4 pt-2.5 [scrollbar-width:none] md:static md:mx-0 md:gap-[1.625rem] md:bg-transparent md:px-0 md:pt-0 [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (t === "chat") setUnread(0);
                  setTab(t);
                }}
                aria-current={shown === t ? "page" : undefined}
                className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-3 text-[0.8125rem] font-bold uppercase tracking-[0.06em] transition-colors ${
                  shown === t ? "border-[#ff5500] text-[#ff5500]" : "border-transparent text-[#8a8a8a] hover:text-white"
                }`}
              >
                {TAB_LABELS[t]}
                {t === "members" ? <span className="text-xs font-semibold tracking-normal text-[#666]">{club.members.length}</span> : null}
                {t === "chat" && unread && shown !== "chat" ? (
                  <span className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[5px] bg-[#3a3a3a] px-1 text-[0.6875rem] tracking-normal text-white">
                    {unread}
                  </span>
                ) : null}
                {t === "manage" && club.requests.length ? (
                  <span className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[5px] bg-[#ff5500] px-1 text-[0.6875rem] tracking-normal text-white">
                    {club.requests.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          {shown === "overview" && <OverviewTab onTab={setTab} />}
          {shown === "members" && <MembersTab />}
          {shown === "leaderboard" && <LeaderboardTab />}
          {shown === "tournaments" && <TournamentsTab />}
          {shown === "chat" && <ChatTab invite={invite} />}
          {shown === "manage" && <ManageTab />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${club.name}?`}
        body={club.private ? "It's invite only: to come back you'll need a new invite or an accepted request." : "You can join again at any time."}
        confirmLabel="Leave clan"
        danger
        busy={busy}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void act(`/api/clubs/${club.id}/leave`);
        }}
      />
    </ClanContext.Provider>
  );
}
