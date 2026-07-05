"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadgeInline } from "@/components/rank-badge";
import { RankTierLetter } from "@/types";
import { formatUsername } from "@/lib/format";

interface SearchPlayer {
  id: string;
  username: string;
  discordUsername?: string | null;
  avatarUrl: string;
  rank: string;
  elo: number;
}

interface PlayerSearchProps {
  className?: string;
  placeholder?: string;
  /** Called after navigating to a profile (e.g. to close a mobile menu). */
  onNavigate?: () => void;
  autoFocus?: boolean;
}

/**
 * FACEIT-style player search with an autocomplete suggestions dropdown.
 * Loads the (small) player list once and filters client-side.
 */
export function PlayerSearch({
  className = "",
  placeholder = "Search players…",
  onNavigate,
  autoFocus = false,
}: PlayerSearchProps) {
  const [players, setPlayers] = useState<SearchPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((data) => setPlayers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return players
      .filter((p) => p.username.toLowerCase().includes(q))
      .slice(0, 6);
  }, [players, query]);

  const go = (name: string) => {
    router.push(`/profile?player=${encodeURIComponent(name)}`);
    setQuery("");
    setOpen(false);
    setActive(0);
    onNavigate?.();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (suggestions.length > 0) {
      go(suggestions[Math.min(active, suggestions.length - 1)].username);
    } else {
      go(q);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form onSubmit={submit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hl-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoFocus={autoFocus}
            aria-label="Search players"
            className="w-full bg-hl-base border border-hl-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50 transition-colors"
          />
        </div>
      </form>

      {open && query.trim() && (
        <div className="absolute top-full left-0 mt-2 w-full min-w-[15rem] bg-hl-panel border border-hl-border rounded-lg shadow-2xl overflow-hidden z-50">
          {suggestions.length === 0 ? (
            <div className="px-3 py-3 text-sm text-hl-muted">
              No players found for &quot;{query.trim()}&quot;.
            </div>
          ) : (
            suggestions.map((p, idx) => (
              <button
                key={p.id}
                type="button"
                onMouseEnter={() => setActive(idx)}
                onClick={() => go(p.username)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  idx === active ? "bg-hl-panel-light" : "hover:bg-hl-panel-light/60"
                }`}
              >
                <Avatar className="w-7 h-7 border border-hl-border shrink-0">
                  {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.username} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                    {p.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-white">
                  {formatUsername(p.username, p.discordUsername)}
                </span>
                <RankBadgeInline rank={p.rank as RankTierLetter} />
                <span className="text-xs stat-number text-hl-gold w-12 text-right">
                  {p.elo}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
