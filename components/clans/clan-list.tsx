"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { ClubMark } from "@/components/club-identity";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/session-provider";
import { useNow } from "@/components/use-now";
import { ClanCard } from "@/components/clans/clan-card";
import { CreateClanDialog } from "@/components/clans/create-clan-dialog";
import { BTN_PRIMARY, INPUT, NativeSelect, PANEL } from "@/components/clans/ui";
import type { ClanListData } from "@/components/clans/types";
import { CLAN_SORTS, CLAN_SORT_LABELS, clanHref, sortClans, type ClanSort } from "@/lib/clan-ui";
import { QUEUE_REGIONS, regionMeta } from "@/lib/regions";

type Joining = "all" | "open" | "private";

/** Chat messages since the clan page was last opened (the sidebar's "seen" mark). */
function unreadSince(clubId: string, times: number[]): number {
  try {
    const seen = Number(window.localStorage.getItem(`hl-club-seen:${clubId}`) || 0);
    return times.filter((t) => t > seen).length;
  } catch {
    return 0;
  }
}

/**
 * The clan list (docs/CLANS_UI_PLAN.md §3): Create clan, your clans, then every
 * clan as a card with search, sort and Open / Invite only.
 */
export function ClanList() {
  const { session, loaded } = useSession();
  const searchParams = useSearchParams();
  const now = useNow(false);
  const [data, setData] = useState<ClanListData | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(() => searchParams.get("create") === "1");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ClanSort>("active");
  const [joining, setJoining] = useState<Joining>("all");
  const [region, setRegion] = useState("ALL");
  const [unread, setUnread] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/clubs");
        const body = (await res.json()) as ClanListData;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [session?.discordId]);

  useEffect(() => {
    if (!session?.discordId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/clubs/sidebar");
        const body = (await res.json()) as { clubs?: { id: string; chatTimes: number[] }[] };
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const c of body.clubs ?? []) next[c.id] = unreadSince(c.id, c.chatTimes ?? []);
        setUnread(next);
      } catch {
        /* no unread counts */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [session?.discordId]);

  const clubs = useMemo(() => data?.clubs ?? [], [data]);
  const regions = useMemo(() => [...new Set(clubs.map((c) => c.region))], [clubs]);
  const mine = useMemo(() => clubs.filter((c) => c.mine), [clubs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = clubs.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q)) &&
        (joining === "all" || (joining === "open" ? !c.private : c.private)) &&
        (region === "ALL" || c.region === region)
    );
    return sortClans(list, sort);
  }, [clubs, query, joining, region, sort]);

  return (
    <div className="hl-page-wide max-w-[73.75rem] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.625rem] font-bold tracking-[-0.01em] text-[#ededed]">Clans</h1>
          <p className="mt-1 max-w-[35rem] text-sm text-[#8a8a8a]">
            Communities with their own tag, chat, leaderboard and tournaments.
            {loaded && !session ? (
              <>
                {" "}
                <Link href="/login" className="font-semibold text-[#ededed] underline underline-offset-[3px]">
                  Log in
                </Link>{" "}
                to join or create one.
              </>
            ) : null}
          </p>
        </div>
        {session ? (
          <div className="flex w-full flex-row-reverse items-center justify-between gap-3.5 sm:w-auto sm:flex-row">
            <small className="text-right text-xs leading-snug text-[#8a8a8a]">
              {(data?.createCost ?? 2000).toLocaleString()} HL Coins
              <br />
              {data?.ownedCount ?? 0} of {data?.maxOwned ?? 3} owned
            </small>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => setCreating(true)}
              disabled={!!data && data.ownedCount >= data.maxOwned}
            >
              <Plus className="h-4 w-4" /> Create clan
            </button>
          </div>
        ) : null}
      </div>

      {mine.length ? (
        <section className="space-y-2.5">
          <h2 className="text-base font-bold text-[#ededed]">Your clans</h2>
          <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden">
            {mine.map((c) => (
              <Link
                key={c.id}
                href={clanHref(c.id)}
                className={`${PANEL} relative flex w-[80%] shrink-0 snap-start items-center gap-3 overflow-hidden px-3.5 py-3 hover:border-white/15 sm:w-auto`}
              >
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c.accentColor }} />
                <ClubMark tag={c.tag} accentColor={c.accentColor} logoUrl={c.logoUrl} size={36} />
                <span className="min-w-0">
                  <b className="block truncate font-semibold text-[#ededed]">
                    {c.name} <span className="text-[0.8125rem] font-semibold text-[#ff5500]">[{c.tag}]</span>
                  </b>
                  <small className="block text-xs text-[#8a8a8a]">
                    {c.myRole ?? "Member"} · {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
                  </small>
                </span>
                {unread[c.id] ? (
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#ff5500]" title="New chat messages">
                    <i className="h-1.5 w-1.5 rounded-full bg-[#ff5500]" />
                    {unread[c.id]} new
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold text-[#ededed]">All clans</h2>
          {data ? (
            <span className="text-xs text-[#8a8a8a]">
              {shown.length} of {clubs.length}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="relative block min-w-[13.75rem] flex-[1_1_100%] sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]" />
            <input
              className={`${INPUT} pl-9`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or tag"
              aria-label="Search clans"
            />
          </label>
          <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as ClanSort)} aria-label="Sort">
            {CLAN_SORTS.map((s) => (
              <option key={s} value={s}>
                {CLAN_SORT_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          {regions.length > 1 ? (
            <NativeSelect value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
              <option value="ALL">All regions</option>
              {QUEUE_REGIONS.filter((r) => regions.includes(r.id)).map((r) => (
                <option key={r.id} value={r.id}>
                  {regionMeta(r.id).label}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <div className="inline-flex overflow-hidden rounded-lg border border-white/[0.07]" role="group" aria-label="Joining">
            {(
              [
                ["all", "All"],
                ["open", "Open"],
                ["private", "Invite only"],
              ] as const
            ).map(([k, label], i) => (
              <button
                key={k}
                type="button"
                onClick={() => setJoining(k)}
                aria-pressed={joining === k}
                className={`h-[2.125rem] px-3 text-[0.8125rem] font-medium ${i ? "border-l border-white/[0.07]" : ""} ${
                  joining === k ? "bg-[#262626] text-[#ededed]" : "bg-[#141414] text-[#8a8a8a] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!data && !failed ? (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[13.5rem] rounded-[0.625rem]" />
            ))}
          </div>
        ) : shown.length ? (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => (
              <ClanCard key={c.id} clan={c} now={now} />
            ))}
          </div>
        ) : (
          <div className={`${PANEL} px-5 py-11 text-center`}>
            <b className="text-[0.9375rem] font-semibold text-[#ededed]">
              {failed ? "Couldn't load the clans" : clubs.length ? "No clans match" : "No clans yet"}
            </b>
            <p className="mt-1 text-[0.8125rem] text-[#8a8a8a]">
              {failed ? "Try again in a moment." : clubs.length ? "Try another name or tag." : "Be the first to start one."}
            </p>
          </div>
        )}
      </section>

      <p className="py-1 text-center text-[0.8125rem] text-[#8a8a8a]">
        Looking for a league team with a fixed roster?{" "}
        <Link href="/teams" className="font-semibold text-[#bdbdbd] underline decoration-[#555] underline-offset-[3px]">
          Teams
        </Link>{" "}
        are separate from clans.
      </p>

      {session && data ? (
        <CreateClanDialog
          open={creating}
          onOpenChange={setCreating}
          cost={data.createCost}
          ownedCount={data.ownedCount}
          maxOwned={data.maxOwned}
        />
      ) : null}
    </div>
  );
}
