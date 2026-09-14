"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Swords } from "lucide-react";
import { useState } from "react";
import { ProfileMenu } from "@/components/profile-menu";
import { usePlayRegion } from "@/components/use-play-region";
import { PLAY_REGIONS } from "@/lib/regions";

const CENTER_TABS = [
  { id: "matchmaking", label: "Matchmaking", href: "/queue" as const },
  { id: "league", label: "League", soon: true },
  { id: "tournaments", label: "Tournaments", soon: true },
] as const;

/** Game + region on the left, MATCHMAKING / LEAGUE / TOURNAMENTS center, avatar right. */
export function TopBar() {
  const pathname = usePathname();
  const { region, setRegion, meta } = usePlayRegion();
  const [regionOpen, setRegionOpen] = useState(false);
  const matchmakingOn =
    pathname === "/" ||
    pathname === "/queue" ||
    pathname === "/leaderboards" ||
    pathname.startsWith("/match");
  const onRank = pathname === "/leaderboards";

  return (
    <header className="h-[var(--hl-topbar-h)] shrink-0 flex items-stretch px-5 gap-3 relative z-30 bg-[#111] border-b border-white/[0.06]">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 rounded-md bg-[#1a1a1a] border border-white/10 px-2 py-1.5">
          <Swords className="w-4 h-4 text-[#ff5500]" />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setRegionOpen((v) => !v)}
            className="flex items-center gap-1 text-[13px] font-bold text-hl-muted hover:text-white px-1.5 py-1 rounded-md"
          >
            {meta.short}
            <ChevronDown className="w-3 h-3" />
          </button>
          {regionOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40"
                aria-label="Close region menu"
                onClick={() => setRegionOpen(false)}
              />
              <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-hl-border bg-hl-panel shadow-xl py-1">
                {PLAY_REGIONS.map((r) => (
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
      </div>

      <nav className="absolute inset-x-0 top-0 h-full flex items-end justify-center gap-8 pointer-events-none">
        {(onRank
          ? ([{ id: "matchmaking", label: "Matchmaking", href: "/leaderboards" as const }] as const)
          : CENTER_TABS
        ).map((tab) => {
          if (!("href" in tab)) {
            return (
              <span
                key={tab.id}
                title="Coming soon"
                className="pointer-events-auto h-full flex items-center text-[14px] font-bold header-caps text-[#6a6a6a] cursor-default"
              >
                {tab.label}
              </span>
            );
          }
          const active = tab.id === "matchmaking" && matchmakingOn;
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
