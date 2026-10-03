"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Swords } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnline } from "@/components/online-status";
import { ProfileInventory } from "@/components/profile-inventory";
import { ProfilePageBackdrop } from "@/components/profile-background";
import { useSession } from "@/components/session-provider";
import { IdentityCard, type FriendState } from "@/components/profile/identity-card";
import { ProfileSidebar } from "@/components/profile/profile-sidebar";
import { SummaryTab } from "@/components/profile/summary-tab";
import { MatchesTab } from "@/components/profile/matches-tab";
import { StatsTab } from "@/components/profile/stats-tab";
import { ClansTab, FriendsTab, GuestbookTab, TeamsTab } from "@/components/profile/social-tabs";
import { useProfileTab } from "@/components/profile/use-profile-tab";
import { COUNTRY_CHANGE_EVENT, countryName as countryLabel, flagPath } from "@/lib/countries";
import { MATCH_MODE_LABEL } from "@/lib/match-mode";
import { profileHref, type ProfileTab } from "@/lib/profile-link";
import type { InventoryItem } from "@/types";
import type { ProfileClan, ProfilePlayer } from "@/components/profile/types";

const GAMES_TABS: { id: ProfileTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "matches", label: "Match history" },
  { id: "stats", label: "Stats" },
];

export function ProfileSkeleton() {
  return (
    <div className="hl-page-wide grid gap-6 lg:grid-cols-[18.75rem_1fr]">
      <Skeleton className="h-[16rem] rounded-xl lg:h-[26rem]" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** When the season's peak happened: the first time this season's curve reached it. */
function peakTime(player: ProfilePlayer): string | null {
  const history = player.eloHistory ?? [];
  const times = player.eloTimes ?? [];
  let best = -1;
  let at = -1;
  for (let i = history.lastIndexOf(null) + 1; i < history.length; i++) {
    const v = history[i];
    if (v != null && v > best) {
      best = v;
      at = i;
    }
  }
  return at >= 0 && best === player.peakElo ? times[at] ?? null : null;
}

/**
 * A player's profile (docs/PROFILE_UI_PLAN.md): FACEIT's two columns — the
 * identity card and its sections on the left, the tabs on the right. On phones
 * it is one column: the card (with the rank), the tabs, then the left sections.
 */
export function ProfileView({ name }: { name: string }) {
  const { session } = useSession();
  const myName = session?.playerName ?? null;
  const [tab, setTab] = useProfileTab();
  const [player, setPlayer] = useState<ProfilePlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendState, setFriendState] = useState<FriendState>("none");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [clans, setClans] = useState<ProfileClan[]>([]);
  const [clansLoaded, setClansLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/players/${encodeURIComponent(name)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "Player not found" : "Failed to load this profile");
          return;
        }
        const data = (await res.json()) as ProfilePlayer;
        if (cancelled) return;
        setPlayer(data);
        setInventory(data.inventory ?? []);
        // Old links and aliases (Discord @handle, a renamed player) land on the
        // canonical URL without another request.
        if (data.username && data.username !== name) {
          window.history.replaceState(null, "", `${profileHref(data.username)}${window.location.search}`);
        }
      } catch {
        if (!cancelled) setError("Failed to load this profile");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [name]);

  const username = player?.username ?? null;

  // Is the profile I'm viewing already a friend / pending?
  useEffect(() => {
    if (!myName || !username || username === myName) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/friends");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if ((data.friends ?? []).some((f: { name: string }) => f.name === username)) setFriendState("friends");
        else if ((data.outgoing ?? []).some((r: { name: string }) => r.name === username)) setFriendState("pending");
        else setFriendState("none");
      } catch {
        /* ignore */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [myName, username]);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetch(`/api/clubs?player=${encodeURIComponent(username)}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setClans(Array.isArray(d.clubs) ? d.clubs : []))
      .catch(() => !cancelled && setClans([]))
      .finally(() => !cancelled && setClansLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Your own profile follows a country change made in the country prompt.
  useEffect(() => {
    const onCountry = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (!code) return;
      setPlayer((prev) =>
        prev && myName && prev.username === myName
          ? { ...prev, country: code, countryName: countryLabel(code), countryFlag: flagPath(code) }
          : prev
      );
    };
    window.addEventListener(COUNTRY_CHANGE_EVENT, onCountry);
    return () => window.removeEventListener(COUNTRY_CHANGE_EVENT, onCountry);
  }, [myName]);

  const addFriend = useCallback(
    async (toName: string, updateHeader: boolean): Promise<string> => {
      try {
        const res = await fetch("/api/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toName }),
        });
        const data = await res.json();
        if (!res.ok) return data.error || "Failed to add friend";
        if (data.status === "friends") {
          if (updateHeader) setFriendState("friends");
          return `You're now friends with ${toName}!`;
        }
        if (updateHeader) setFriendState("pending");
        return data.status === "exists" ? "Request already sent." : `Friend request sent to ${toName}.`;
      } catch {
        return "Failed to add friend";
      }
    },
    []
  );

  const isOnline = useOnline({ names: [username] });
  const peakAt = useMemo(() => (player ? peakTime(player) : null), [player]);

  if (error) {
    return (
      <div className="hl-page-wide py-16 text-center">
        <h1 className="mb-4 text-2xl font-bold text-white">{error}</h1>
        <Link href="/leaderboards" className="text-hl-gold hover:underline">
          Return to Rankings
        </Link>
      </div>
    );
  }
  if (!player) return <ProfileSkeleton />;

  const isOwn = !!myName && player.username === myName;
  const online = isOnline({ name: player.username });
  const bgColor =
    inventory.find((i) => i.type === "background" && i.equipped)?.asset ?? player.cosmetics?.background?.asset ?? null;
  const gamesTab = tab === "summary" || tab === "matches" || tab === "stats";
  const friends = player.friends ?? [];
  const teams = player.teams ?? [];
  const mainTabs: { id: ProfileTab; label: string; count?: number; active: boolean }[] = [
    { id: "summary", label: "Games", active: gamesTab },
    { id: "friends", label: "Friends", count: friends.length, active: tab === "friends" },
    { id: "guestbook", label: "Guestbook", active: tab === "guestbook" },
    { id: "inventory", label: "Inventory", active: tab === "inventory" },
    { id: "clans", label: "Clans", count: clans.length, active: tab === "clans" },
    { id: "teams", label: "Teams", count: teams.length, active: tab === "teams" },
  ];

  return (
    <div className="relative min-h-full">
      <ProfilePageBackdrop color={bgColor} />
      <div className="hl-page-wide relative grid items-start gap-x-6 gap-y-5 [grid-template-areas:'id'_'main'_'side'] lg:grid-cols-[18.75rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'id_main'_'side_main']">
        <div className="[grid-area:id] min-w-0">
          <IdentityCard
            player={player}
            isOwn={isOwn}
            online={online}
            friendState={friendState}
            onAddFriend={() => addFriend(player.username, true)}
          />
        </div>

        <div className={`[grid-area:side] min-w-0 ${tab === "summary" ? "" : "hidden lg:block"}`}>
          <ProfileSidebar player={player} isOwn={isOwn} clans={clans} />
        </div>

        <div className="[grid-area:main] min-w-0 space-y-5">
          <nav
            aria-label="Profile sections"
            className="sticky top-0 z-20 -mx-4 flex gap-5 overflow-x-auto border-b border-white/[0.08] bg-[#161616]/95 px-4 pt-3 backdrop-blur [scrollbar-width:none] md:-mx-0 md:px-0 lg:static lg:bg-transparent lg:pt-0 lg:backdrop-blur-none"
          >
            {mainTabs.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={t.active ? "page" : undefined}
                className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-3 text-[0.875rem] font-bold uppercase tracking-wide transition-colors ${
                  t.active ? "border-[#ff5500] text-[#ff5500]" : "border-transparent text-[#8a8a8a] hover:text-white"
                }`}
              >
                {t.label}
                {t.count ? <span className="text-xs font-bold text-[#6a6a6a]">{t.count}</span> : null}
              </button>
            ))}
          </nav>

          {gamesTab ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1" role="tablist" aria-label="Games">
                {GAMES_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`h-[2.125rem] rounded-lg px-3.5 text-[0.875rem] font-semibold ${
                      tab === t.id ? "bg-[#ff5500]/15 text-[#ff5500]" : "text-[#9a9a9a] hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="hidden items-center gap-2 text-[0.8125rem] text-[#8a8a8a] sm:flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#ff5500]">
                  <Swords className="h-3.5 w-3.5 text-white" />
                </span>
                Counter Blox · {MATCH_MODE_LABEL}
              </span>
            </div>
          ) : null}

          {tab === "summary" && <SummaryTab player={player} peakAt={peakAt} onTab={setTab} />}
          {tab === "matches" && (
            <MatchesTab
              playerName={player.username}
              initial={player.matchHistory ?? []}
              initialHasMore={!!player.hasMoreMatches}
            />
          )}
          {tab === "stats" && <StatsTab player={player} />}
          {tab === "friends" && (
            <FriendsTab friends={friends} myName={myName} onAddFriend={(n) => addFriend(n, false)} />
          )}
          {tab === "guestbook" && <GuestbookTab profileName={player.username} />}
          {tab === "inventory" && (
            <ProfileInventory key={player.username} items={inventory} isOwn={isOwn} onChange={setInventory} />
          )}
          {tab === "clans" && <ClansTab clans={clans} loaded={clansLoaded} />}
          {tab === "teams" && <TeamsTab teams={teams} />}
        </div>
      </div>
    </div>
  );
}
