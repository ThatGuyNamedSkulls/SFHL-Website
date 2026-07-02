"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserSession } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationsBell } from "@/components/notifications-bell";
import {
  Search,
  Users,
  UserPlus,
  Play,
  BarChart3,
  TrendingUp,
  Rss,
  Building2,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Whether this item "owns" the active highlight for its route. When several
   * items share a destination (e.g. Search/Rank → /leaderboards), only the
   * owner lights up so we never highlight two items at once.
   */
  owns?: boolean;
}

const TOP_NAV: NavItem[] = [
  { href: "/leaderboards", label: "Search", icon: Search, owns: false },
  { href: "/party-finder", label: "Party Finder", icon: Users, owns: true },
  { href: "/friends", label: "Friends", icon: UserPlus, owns: true },
  { href: "/queue", label: "Play", icon: Play, owns: true },
  { href: "/leaderboards", label: "Rank", icon: BarChart3, owns: true },
  { href: "/profile", label: "Track", icon: TrendingUp, owns: true },
  { href: "/matches", label: "Feed", icon: Rss, owns: true },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/tournaments", label: "Clubs", icon: Building2, owns: true },
  { href: "/party-finder?create=1", label: "Create", icon: Plus, owns: false },
];

function NavLink({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-active={active}
      className={`hl-nav-item flex items-center gap-4 h-11 px-4 rounded-md mx-1 ${
        active ? "text-hl-gold" : "text-hl-muted hover:text-white hover:bg-hl-panel-light/40"
      }`}
      title={item.label}
    >
      <Icon className={`w-5 h-5 shrink-0 ${active ? "text-hl-gold" : ""}`} />
      <span className="text-sm font-semibold whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150">
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user ?? null))
      .catch(() => {});
  }, [pathname]);

  const isActive = (item: NavItem) => {
    if (item.owns === false) return false;
    const base = item.href.split("?")[0];
    return pathname === base;
  };

  const profileHref = session
    ? `/profile?player=${encodeURIComponent(session.playerName || session.username)}`
    : "/login";

  return (
    // Fixed 64px placeholder keeps layout stable; the panel itself is absolutely
    // positioned so it overlays the content when it expands on hover (FACEIT-style).
    <div className="relative w-[64px] shrink-0 h-screen">
    <aside className="group/sidebar hl-sidebar absolute inset-y-0 left-0 w-[64px] hover:w-[210px] hover:shadow-2xl hover:shadow-black/50 transition-[width] duration-200 z-40 flex flex-col overflow-hidden">
      {/* Logo */}
      <Link
        href="/"
        className="flex items-center gap-3 h-16 px-4 shrink-0 border-b border-hl-border"
        title="HyperLeague"
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-gold-gradient shadow-[0_0_15px_rgba(255,85,0,0.4)] shrink-0">
          <Play className="w-4 h-4 text-hl-base fill-hl-base" />
        </div>
        <span className="text-lg font-black text-white tracking-tight whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150">
          HYPER<span className="text-hl-gold">LEAGUE</span>
        </span>
      </Link>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col gap-0.5">
        {TOP_NAV.map((item) => (
          <NavLink key={item.label} item={item} active={isActive(item)} />
        ))}

        <div className="h-px bg-hl-border mx-4 my-3" />

        {BOTTOM_NAV.map((item) => (
          <NavLink key={item.label} item={item} active={isActive(item)} />
        ))}
      </nav>

      {/* Bottom section: notifications + user */}
      <div className="shrink-0 border-t border-hl-border py-3 flex flex-col gap-0.5">
        <NotificationsBell />

        <Link
          href="/settings"
          data-active={pathname === "/settings"}
          className={`hl-nav-item flex items-center gap-4 h-11 px-4 rounded-md mx-1 ${
            pathname === "/settings" ? "text-hl-gold" : "text-hl-muted hover:text-white hover:bg-hl-panel-light/40"
          }`}
          title="Settings"
        >
          <Settings className="w-5 h-5 shrink-0" />
          <span className="text-sm font-semibold whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150">
            Settings
          </span>
        </Link>

        <Link
          href={profileHref}
          className="flex items-center gap-3 h-12 px-4 mx-1 rounded-md hover:bg-hl-panel-light/40"
          title={session ? session.username : "Log in"}
        >
          <Avatar className="w-8 h-8 border border-hl-border shrink-0">
            {session?.avatar ? <AvatarImage src={session.avatar} /> : null}
            <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
              {(session?.username ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-semibold text-white truncate whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150">
            {session ? session.username : "Log in"}
          </span>
        </Link>
      </div>
    </aside>
    </div>
  );
}
