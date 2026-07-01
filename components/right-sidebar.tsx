"use client";

import Link from "next/link";
import { Swords, Users, Bell, UserPlus, type LucideIcon } from "lucide-react";

interface RailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  accent?: boolean;
}

const ITEMS: RailItem[] = [
  { href: "/queue", label: "Matchmaking", icon: Swords, accent: true },
  { href: "/party-finder", label: "Parties", icon: Users },
  { href: "/matches", label: "Notifications", icon: Bell },
  { href: "/leaderboards", label: "Add friend", icon: UserPlus },
];

/** Narrow right-edge icon rail (FACEIT-style). Hidden on small screens. */
export function RightSidebar() {
  return (
    <aside className="hidden lg:flex flex-col items-center gap-2 w-[52px] shrink-0 border-l border-hl-border bg-[#141414] py-4 sticky top-0 h-screen">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            title={item.label}
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              item.accent
                ? "bg-hl-gold/15 text-hl-gold hover:bg-hl-gold/25"
                : "text-hl-muted hover:text-white hover:bg-hl-panel-light/50"
            }`}
          >
            <Icon className="w-[18px] h-[18px]" />
          </Link>
        );
      })}
    </aside>
  );
}
