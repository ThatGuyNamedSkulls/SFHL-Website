"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, User, LogOut, Trophy, Swords, Gamepad2, Settings, Shield, Award } from "lucide-react";
import { UserSession } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PlayerSearch } from "@/components/player-search";
import { QueuePill } from "@/components/queue-pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const pathname = usePathname();

  // Fetch session. Only change the UI on a definitive answer (a 200 telling us
  // who the user is, or that they're logged out). On a transient error/non-OK
  // response we keep the current state instead of flipping to "logged out" —
  // that flip was what made login appear to drop at random.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || data === null) return;
        setSession(data.user ?? null);
      })
      .catch(() => {
        /* transient — keep the last known session */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const navLinks = [
    { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
    { href: "/matches", label: "Matches", icon: Swords },
    { href: "/ranks", label: "Ranks", icon: Award },
    { href: "/tournaments", label: "Tournaments", icon: Shield },
    { href: "/queue", label: "Play", icon: Gamepad2 },
  ];

  const profileHref = session
    ? `/profile?player=${encodeURIComponent(session.playerName || session.username)}`
    : "/login";

  return (
    <nav className="sticky top-0 left-0 w-full z-50 bg-hl-panel/95 backdrop-blur-md border-b border-hl-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group shrink-0">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-gradient shadow-[0_0_15px_rgba(255,85,0,0.35)] group-hover:shadow-[0_0_25px_rgba(255,85,0,0.55)] transition-shadow">
              <span className="font-black text-hl-base tracking-tighter text-lg">
                SF
              </span>
            </div>
            <span className="text-xl font-black text-white tracking-tight hidden sm:block">
              SFHL
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-5 ml-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-semibold tracking-wide header-caps transition-colors ${
                  pathname === link.href
                    ? "text-hl-gold"
                    : "text-hl-muted hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Search (FACEIT-style player search with autocomplete) */}
          <PlayerSearch className="hidden lg:block flex-1 max-w-xs ml-auto" />

          {/* User / Login */}
          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <QueuePill discordId={session?.discordId} />
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 outline-none">
                  <Avatar className="w-8 h-8 border border-hl-border">
                    {session.avatar ? (
                      <AvatarImage src={session.avatar} />
                    ) : null}
                    <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                      {session.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-semibold text-white max-w-[120px] truncate">
                    {session.username}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-hl-panel border-hl-border text-white w-48"
                >
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {session.username}
                      </p>
                      {session.playerName && (
                        <p className="text-xs leading-none text-hl-muted mt-1">
                          Linked: {session.playerName}
                        </p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-hl-border" />
                  <DropdownMenuItem className="hover:bg-hl-panel-light focus:bg-hl-panel-light cursor-pointer">
                    <Link href={profileHref} className="flex w-full items-center">
                      <User className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="hover:bg-hl-panel-light focus:bg-hl-panel-light cursor-pointer">
                    <Link href="/settings" className="flex w-full items-center">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-hl-border" />
                  <DropdownMenuItem className="hover:bg-hl-panel-light focus:bg-hl-panel-light cursor-pointer text-hl-red focus:text-hl-red">
                    <Link href="/api/auth/logout" className="flex w-full items-center">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href="/login"
                className="text-sm font-bold bg-hl-panel-light hover:bg-hl-base border border-hl-border rounded-lg px-4 py-2 transition-colors flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                Login
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 text-hl-muted hover:text-white ml-auto"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="lg:hidden bg-hl-panel border-b border-hl-border absolute top-full left-0 w-full shadow-2xl">
          <div className="px-4 py-6 flex flex-col gap-4">
            {/* Mobile search */}
            <PlayerSearch onNavigate={() => setIsOpen(false)} />

            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`text-lg font-bold header-caps ${
                  pathname === link.href ? "text-hl-gold" : "text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}

            <div className="w-full h-px bg-hl-border my-2" />

            {session ? (
              <>
                <Link
                  href={profileHref}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 text-lg font-bold text-white"
                >
                  <Avatar className="w-8 h-8">
                    {session.avatar ? <AvatarImage src={session.avatar} /> : null}
                    <AvatarFallback>{session.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 text-lg font-bold text-white"
                >
                  <Settings className="w-5 h-5" />
                  Settings
                </Link>
                <Link
                  href="/api/auth/logout"
                  onClick={() => setIsOpen(false)}
                  className="text-lg font-bold text-hl-red mt-2"
                >
                  Log out
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setIsOpen(false)}
                className="mt-2 inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gold-gradient text-hl-base font-bold"
              >
                <User className="w-5 h-5" />
                Login
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
