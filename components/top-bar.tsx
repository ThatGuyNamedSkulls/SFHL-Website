"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Swords } from "lucide-react";
import { useState } from "react";
import { ProfileMenu } from "@/components/profile-menu";
import { usePlayRegion } from "@/components/use-play-region";
import { QUEUE_REGIONS, isQueueRegion } from "@/lib/regions";

const CENTER_TABS = [
  { id: "matchmaking", label: "Matchmaking", href: "/queue" as const },
  { id: "league", label: "League", href: "/league" as const },
  { id: "tournaments", label: "Tournaments", href: "/tournaments" as const },
] as const;

const PAGE_TITLE: { test: (path: string) => boolean; label: string }[] = [
  { test: (p) => p === "/" , label: "Home" },
  { test: (p) => p === "/queue" || p === "/subs", label: "Play" },
  { test: (p) => p.startsWith("/match"), label: "Match" },
  { test: (p) => p === "/leaderboards", label: "Rank" },
  { test: (p) => p === "/party-finder", label: "Social" },
  { test: (p) => p === "/friends", label: "Friends" },
  { test: (p) => p === "/shop", label: "Shop" },
  { test: (p) => p === "/profile", label: "Profile" },
  { test: (p) => p === "/track", label: "Track" },
  { test: (p) => p === "/feed", label: "Feed" },
  { test: (p) => p === "/settings", label: "Settings" },
  { test: (p) => p === "/clans" || p.startsWith("/clans/"), label: "Clans" },
  { test: (p) => p === "/tournaments" || p.startsWith("/tournaments/"), label: "Tournaments" },
  { test: (p) => p === "/league", label: "League" },
];

/** Game + region on the left, MATCHMAKING / LEAGUE / TOURNAMENTS center, avatar right. */
export function TopBar() {
  const pathname = usePathname();
  const { region, setRegion, meta, queueLocked } = usePlayRegion();
  const [regionOpen, setRegionOpen] = useState(false);
  const matchmakingOn =
    pathname === "/" ||
    pathname === "/queue" ||
    pathname === "/leaderboards" ||
    pathname.startsWith("/match");
  const tournamentsOn = pathname === "/tournaments" || pathname.startsWith("/tournaments/");
  const leagueOn = pathname === "/league";
  const onRank = pathname === "/leaderboards";
  const mobileTitle = PAGE_TITLE.find((t) => t.test(pathname))?.label ?? "HyperLeague";

  return (
    <header className="h-[var(--hl-topbar-h)] shrink-0 flex items-stretch px-3 sm:px-5 gap-2 sm:gap-3 relative z-30 bg-[#111] border-b border-white/[0.06]">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 rounded-md bg-[#1a1a1a] border border-white/10 px-2 py-1.5">
          <Swords className="w-4 h-4 text-[#ff5500]" />
        </div>
        <div className="relative">
          <button
            type="button"
            disabled={queueLocked}
            title={queueLocked ? "Cancel queue to switch region" : undefined}
            onClick={() => {
              if (queueLocked) return;
              setRegionOpen((v) => !v);
            }}
            className={`flex items-center gap-1 text-[13px] font-bold px-1.5 py-1 rounded-md ${
              queueLocked
                ? "text-hl-muted cursor-not-allowed"
                : "text-hl-muted hover:text-white"
            }`}
          >
            {isQueueRegion(region) ? meta.short : "Server"}
            <ChevronDown className="w-3 h-3" />
          </button>
          {regionOpen && !queueLocked && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40"
                aria-label="Close region menu"
                onClick={() => setRegionOpen(false)}
              />
              <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-hl-border bg-hl-panel shadow-xl py-1">
                {QUEUE_REGIONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setRegion(r.id);
                      setRegionOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold ${
                      region === r.id ? "text-hl-gold" : "text-white hover:bg-hl-panel-light/50"
                    }`}
                  >
                    {r.short} · {r.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span className="md:hidden text-[13px] font-black text-white header-caps truncate">
          {mobileTitle}
        </span>
      </div>

      <nav className="hidden md:flex absolute inset-x-0 top-0 h-full items-end justify-center gap-8 pointer-events-none">
        {(onRank
          ? ([{ id: "matchmaking", label: "Matchmaking", href: "/leaderboards" as const }] as const)
          : CENTER_TABS
        ).map((tab) => {
          const active =
            (tab.id === "matchmaking" && matchmakingOn) ||
            (tab.id === "tournaments" && tournamentsOn) ||
            (tab.id === "league" && leagueOn);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`pointer-events-auto h-full flex items-center text-[14px] font-bold header-caps border-b-2 ${
                active
                  ? "text-white border-[#ff5500]"
                  : "text-[#8a8a8a] border-transparent hover:text-white"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center md:hidden">
        <ProfileMenu />
      </div>
    </header>
  );
}
