"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchOverlay } from "@/components/search-overlay";
import {
  Search,
  Users,
  Play,
  BarChart3,
  TrendingUp,
  Rss,
  Building2,
  Plus,
  ShoppingBag,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { apiGetJson } from "@/lib/client-api";

interface NavItem {
  href?: string;
  label: string;
  icon: LucideIcon;
  owns?: boolean;
  search?: boolean;
  create?: boolean;
}

const TOP_NAV: NavItem[] = [
  { label: "Search", icon: Search, search: true },
  { href: "/party-finder", label: "Social", icon: Users, owns: true },
  { href: "/queue", label: "Play", icon: Play, owns: true },
  { href: "/leaderboards", label: "Rank", icon: BarChart3, owns: true },
  { href: "/track", label: "Track", icon: TrendingUp, owns: true },
  { href: "/feed", label: "Feed", icon: Rss, owns: true },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/shop", label: "Shop", icon: ShoppingBag, owns: true },
  { href: "/clubs", label: "Clubs", icon: Building2, owns: true },
  { href: "/party-finder?create=1", label: "Create", icon: Plus, create: true, owns: false },
];

function NavButton({
  item,
  active,
  onSearch,
}: {
  item: NavItem;
  active: boolean;
  onSearch: () => void;
}) {
  const Icon = item.icon;
  const className = `hl-nav-item flex items-center justify-center h-12 w-full ${
    active ? "text-[#ff5500]" : "text-[#8b8b8b] hover:text-white"
  }`;

  const icon = item.create ? (
    <span
      className={`flex items-center justify-center w-6 h-6 rounded-[6px] border ${
        active ? "border-[#ff5500]" : "border-current"
      }`}
    >
      <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
    </span>
  ) : (
    <Icon
      className={`w-[22px] h-[22px] ${item.href === "/queue" && active ? "fill-current" : ""}`}
      strokeWidth={1.75}
      fill={item.label === "Play" && active ? "currentColor" : "none"}
    />
  );

  if (item.search) {
    return (
      <button type="button" data-active={active} className={className} title={item.label} onClick={onSearch}>
        {icon}
      </button>
    );
  }

  return (
    <Link href={item.href!} data-active={active} className={`${className} relative`} title={item.label}>
      {icon}
      {item.href === "/queue" && <PlaySubBadge />}
    </Link>
  );
}

function PlaySubBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { ok, json } = await apiGetJson<{ count?: number }>("/api/subs");
        if (!ok) return;
        if (!cancelled) setCount(Number(json.count ?? 0));
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  if (count <= 0) return null;
  return (
    <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#ffc44d] text-[#1a1400] text-[9px] font-black leading-[14px] text-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);

  const isActive = (item: NavItem) => {
    if (item.search) return searchOpen;
    if (item.owns === false || !item.href) return false;
    const base = item.href.split("?")[0];
    return pathname === base;
  };

  return (
    <>
      <aside className="hl-sidebar shrink-0 h-screen flex flex-col overflow-hidden z-40">
        <Link href="/" className="flex items-center justify-center h-[var(--hl-topbar-h)] shrink-0" title="HyperLeague">
          <Play className="w-5 h-5 text-[#ff5500] fill-[#ff5500] -rotate-[20deg]" />
        </Link>

        <nav className="flex-1 pt-1 flex flex-col gap-0.5">
          {TOP_NAV.map((item) => (
            <NavButton
              key={item.label}
              item={item}
              active={isActive(item)}
              onSearch={() => setSearchOpen(true)}
            />
          ))}

          <div className="h-px bg-white/10 mx-2.5 my-2.5" />

          {BOTTOM_NAV.map((item) => (
            <NavButton
              key={item.label}
              item={item}
              active={isActive(item)}
              onSearch={() => setSearchOpen(true)}
            />
          ))}

          <div className="flex-1" />
          <span
            title="Coming soon"
            className="hl-nav-item flex items-center justify-center h-12 w-full text-[#8b8b8b]"
          >
            <Trophy className="w-[22px] h-[22px]" strokeWidth={1.75} />
          </span>
        </nav>
      </aside>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
