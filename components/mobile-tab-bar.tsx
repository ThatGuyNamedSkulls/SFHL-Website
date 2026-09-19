"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Play,
  Users,
  BarChart3,
  ShoppingBag,
  Ellipsis,
  Search,
  TrendingUp,
  Rss,
  UserPlus,
  Bell,
  Building2,
  Plus,
  Home,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { SearchOverlay } from "@/components/search-overlay";

const TABS: { href: string; label: string; icon: LucideIcon; match?: (path: string) => boolean }[] = [
  {
    href: "/queue",
    label: "Play",
    icon: Play,
    match: (p) => p === "/queue" || p.startsWith("/match") || p === "/subs",
  },
  {
    href: "/party-finder",
    label: "Social",
    icon: Users,
    match: (p) => p === "/party-finder" || p === "/friends",
  },
  { href: "/leaderboards", label: "Rank", icon: BarChart3 },
  { href: "/shop", label: "Shop", icon: ShoppingBag },
];

const MORE_LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/track", label: "Track", icon: TrendingUp },
  { href: "/feed", label: "Feed", icon: Rss },
  { href: "/friends", label: "Friends", icon: UserPlus },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/match/live", label: "Match room", icon: Swords },
  { href: "/clubs", label: "Clubs", icon: Building2 },
  { href: "/party-finder?create=1", label: "Create party", icon: Plus },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const tabActive = (tab: (typeof TABS)[number]) =>
    tab.match ? tab.match(pathname) : pathname === tab.href.split("?")[0];

  return (
    <>
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[#181818]/95 backdrop-blur-md touch-manipulation"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5 h-14">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tabActive(tab);
            return (
              <Link
                key={tab.label}
                href={tab.href}
                onClick={() => setMoreOpen(false)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${
                  active ? "text-[#ff5500]" : "text-[#8b8b8b]"
                }`}
              >
                <Icon
                  className="w-5 h-5"
                  strokeWidth={1.75}
                  fill={tab.label === "Play" && active ? "currentColor" : "none"}
                />
                {tab.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${
              moreOpen ? "text-[#ff5500]" : "text-[#8b8b8b]"
            }`}
          >
            <Ellipsis className="w-5 h-5" strokeWidth={1.75} />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="hl-more-sheet absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-hl-border bg-[#1c1c1c] px-4 pt-3"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  setSearchOpen(true);
                }}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#161616] px-3 py-3 text-sm font-semibold text-white"
              >
                <Search className="w-4 h-4 text-[#ff5500]" />
                Search
              </button>
              {MORE_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#161616] px-3 py-3 text-sm font-semibold text-white"
                  >
                    <Icon className="w-4 h-4 text-[#ff5500]" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
