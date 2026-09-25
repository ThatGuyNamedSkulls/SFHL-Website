"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchOverlay } from "@/components/search-overlay";
import { ClubMark } from "@/components/club-identity";
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
  Crosshair,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { apiGetJson } from "@/lib/client-api";
import { usePolling } from "@/components/use-polling";
import { startPolling } from "@/lib/poll-gate";
import { STATUS_TTL_MS } from "@/components/status-poller";

interface NavItem {
  href?: string;
  label: string;
  icon: LucideIcon;
  owns?: boolean;
  search?: boolean;
  create?: boolean;
}

interface SidebarClub {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
  chatTimes: number[];
  tournaments: { name: string; createdAt: number }[];
}

const TOP_NAV: NavItem[] = [
  { label: "Search", icon: Search, search: true },
  { href: "/party-finder", label: "Party Search", icon: Users, owns: true },
  { href: "/queue", label: "Play", icon: Play, owns: true },
  { href: "/leaderboards", label: "Leaderboard", icon: BarChart3, owns: true },
  { href: "/track", label: "Track", icon: TrendingUp, owns: true },
  { href: "/feed", label: "Feed", icon: Rss, owns: true },
];

function seenKey(id: string) {
  return `hl-club-seen:${id}`;
}

function clubNews(club: SidebarClub): string[] {
  if (typeof window === "undefined") return [];
  const seen = Number(window.localStorage.getItem(seenKey(club.id)) || 0);
  const lines: string[] = [];
  const messages = club.chatTimes.filter((t) => t > seen).length;
  if (messages > 0) lines.push(messages === 1 ? "1 new message" : `${messages} new messages`);
  for (const cup of club.tournaments) {
    if (cup.createdAt > seen) lines.push(`New tournament: ${cup.name}`);
  }
  return lines;
}

function NavRow({
  item,
  active,
  onSearch,
}: {
  item: NavItem;
  active: boolean;
  onSearch: () => void;
}) {
  const Icon = item.icon;
  const className = `hl-nav-item flex items-center gap-3 h-12 w-full px-[21px] ${
    active ? "text-[#ff5500]" : "text-[#8b8b8b] hover:text-white"
  }`;

  const icon = item.create ? (
    <span className="flex items-center justify-center w-[22px] h-[22px] rounded-full border border-current shrink-0">
      <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
    </span>
  ) : (
    <Icon
      className={`w-[22px] h-[22px] shrink-0 ${item.label === "Play" && active ? "fill-current" : ""}`}
      strokeWidth={1.75}
      fill={item.label === "Play" && active ? "currentColor" : "none"}
    />
  );

  const body = (
    <>
      <span className="relative shrink-0">
        {icon}
        {item.href === "/queue" && <PlaySubBadge />}
      </span>
      <span className="hl-nav-label text-[13px] font-semibold">{item.label}</span>
    </>
  );

  if (item.search) {
    return (
      <button type="button" data-active={active} data-search="true" className={className} title={item.label} onClick={onSearch}>
        {body}
      </button>
    );
  }
  return (
    <Link href={item.href!} data-active={active} className={className} title={item.label}>
      {body}
    </Link>
  );
}

function PlaySubBadge() {
  const [count, setCount] = useState(0);
  usePolling(async () => {
    try {
      const { ok, json } = await apiGetJson<{ count?: number }>("/api/subs", { ttlMs: STATUS_TTL_MS });
      if (ok) setCount(Number(json.count ?? 0));
    } catch {
      /* ignore */
    }
  }, 30_000);
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#ffc44d] text-[#1a1400] text-[9px] font-black leading-[14px] text-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function ClubLink({ club, lines }: { club: SidebarClub; lines: string[] }) {
  const [box, setBox] = useState<DOMRect | null>(null);
  return (
    <div
      className="relative"
      onMouseEnter={(e) => setBox(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setBox(null)}
    >
      <Link
        href={`/clans/${club.id}`}
        className="hl-nav-item flex items-center gap-3 h-12 w-full px-[18px] text-white"
      >
        <span className="relative shrink-0">
          <ClubMark tag={club.tag} accentColor={club.accentColor} logoUrl={club.logoUrl} size={26} className="!rounded-full" />
          {lines.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#ff5500]" />
          )}
        </span>
        <span className="hl-nav-label text-[13px] font-semibold truncate">{club.name}</span>
      </Link>
      {box &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[80] min-w-[180px] rounded-lg border border-white/10 bg-[#2a2a2a] px-3 py-2 shadow-xl"
            style={{ left: box.right + 8, top: box.top }}
          >
            <div className="flex items-center gap-2">
              <ClubMark tag={club.tag} accentColor={club.accentColor} logoUrl={club.logoUrl} size={22} className="!rounded-full" />
              <span className="text-sm font-bold text-white">{club.name}</span>
            </div>
            {lines.map((line) => (
              <div key={line} className="mt-1 text-[12px] text-[#c8c8c8]">
                {line}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

function ClubRail() {
  const pathname = usePathname();
  const [clubs, setClubs] = useState<SidebarClub[]>([]);
  const [news, setNews] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/clubs/sidebar");
        const data = await res.json();
        const rows: SidebarClub[] = Array.isArray(data.clubs) ? data.clubs : [];
        if (cancelled) return;
        setClubs(rows);
        const next: Record<string, string[]> = {};
        for (const club of rows) next[club.id] = clubNews(club);
        setNews(next);
      } catch {
        if (!cancelled) setClubs([]);
      }
    };
    const stop = startPolling(load, 30_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <>
      <NavRow
        item={{ href: "/clans", label: "Clans", icon: Building2, owns: true }}
        active={pathname === "/clans" || pathname.startsWith("/clans/")}
        onSearch={() => undefined}
      />
      {clubs.map((club) => (
        <ClubLink key={club.id} club={club} lines={news[club.id] ?? []} />
      ))}
      <NavRow
        item={{ href: "/clans?create=1", label: "Create a Clan", icon: Plus, create: true, owns: false }}
        active={false}
        onSearch={() => undefined}
      />
      <NavRow
        item={{ href: "/teams", label: "Teams", icon: Shield, owns: true }}
        active={pathname === "/teams" || pathname.startsWith("/teams/")}
        onSearch={() => undefined}
      />
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);

  const isActive = (item: NavItem) => {
    if (item.search) return searchOpen;
    if (item.owns === false || !item.href) return false;
    const base = item.href.split("?")[0];
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <>
      <style>{`
        .hl-sidebar { width: 4rem !important; overflow: hidden; transition: width 0.16s ease; }
        .hl-sidebar:hover { width: 15.5rem !important; }
        .hl-sidebar .hl-nav-label {
          display: inline-block;
          max-width: 0;
          opacity: 0;
          overflow: hidden;
          white-space: nowrap;
          vertical-align: middle;
          transition: opacity 0.12s ease, max-width 0.16s ease;
        }
        .hl-sidebar:hover .hl-nav-label { max-width: 11rem; opacity: 1; }
        .hl-sidebar:hover .hl-nav-item[data-active="true"],
        .hl-sidebar:hover .hl-nav-item[data-search="true"] {
          background: #2a2a2a;
          border-radius: 8px;
        }
      `}</style>
      <aside className="hl-sidebar hidden md:flex shrink-0 h-dvh flex-col z-40">
        <Link
          href="/"
          className="flex items-center gap-3 h-[var(--hl-topbar-h)] shrink-0 px-[21px]"
          title="HyperLeague"
        >
          <Play className="w-5 h-5 text-[#ff5500] fill-[#ff5500] -rotate-[20deg] shrink-0" />
          <span className="hl-nav-label text-sm font-black tracking-wide text-white">HyperLeague</span>
        </Link>

        <nav className="flex-1 pt-2 pb-3 flex flex-col min-h-0 gap-0.5">
          {TOP_NAV.map((item) => (
            <NavRow
              key={item.label}
              item={item}
              active={isActive(item)}
              onSearch={() => setSearchOpen(true)}
            />
          ))}

          <div className="h-px bg-white/10 mx-3 my-3" />
          <ClubRail />

          <div className="flex-1 min-h-6" />

          <div className="h-px bg-white/10 mx-3 mb-2" />
          <NavRow
            item={{ href: "/missions", label: "Missions", icon: Crosshair, owns: true }}
            active={pathname.startsWith("/missions")}
            onSearch={() => undefined}
          />
          <NavRow
            item={{ href: "/shop", label: "Shop", icon: ShoppingBag, owns: true }}
            active={pathname === "/shop"}
            onSearch={() => undefined}
          />
        </nav>
      </aside>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
