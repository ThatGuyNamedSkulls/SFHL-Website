"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RankBadgeInline } from "@/components/rank-badge";
import { RankTierLetter } from "@/types";
import { ClubTaggedName } from "@/components/club-identity";
import { BannedTag } from "@/components/banned-tag";
import { apiGetJson } from "@/lib/client-api";
import { profileHref } from "@/lib/profile-link";

interface SearchPlayer {
  id: string;
  username: string;
  discordUsername?: string | null;
  avatarUrl: string;
  rank: string;
  elo: number;
  clubTag?: string | null;
  banned?: boolean;
}

interface PlayerSearchProps {
  className?: string;
  placeholder?: string;
  /** Called after navigating to a profile (e.g. to close a mobile menu). */
  onNavigate?: () => void;
  /** When set, choosing a player fills this instead of opening their profile. */
  onPick?: (username: string) => void;
  /** Fired as the query changes, including when a suggestion is chosen. */
  onQueryChange?: (query: string) => void;
  autoFocus?: boolean;
}

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 200;

/**
 * FACEIT-style player search with an autocomplete suggestions dropdown.
 * Asks the server for matches as you type (debounced), instead of loading
 * every player up front. Answers are remembered per query, so backspacing
 * doesn't refetch.
 */
export function PlayerSearch({
  className = "",
  placeholder = "Search players…",
  onNavigate,
  onPick,
  onQueryChange,
  autoFocus = false,
}: PlayerSearchProps) {
  const [query, setQuery] = useState("");
  // The latest answer and the query it belongs to (it can lag the input).
  const [results, setResults] = useState<{ q: string; players: SearchPlayer[] }>({ q: "", players: [] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");
  const cache = useRef(new Map<string, SearchPlayer[]>());

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const lookup = (text: string) => {
    const q = text.trim().toLowerCase();
    latest.current = q;
    if (timer.current) clearTimeout(timer.current);
    const known = cache.current.get(q);
    if (!q || known) {
      setResults({ q, players: known ?? [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      apiGetJson<SearchPlayer[]>(`/api/players?q=${encodeURIComponent(q)}`)
        .then(({ json }) => {
          const players = Array.isArray(json) ? json : [];
          cache.current.set(q, players);
          if (latest.current !== q) return; // the input moved on
          setResults({ q, players });
          setLoading(false);
        })
        .catch(() => {
          if (latest.current === q) setLoading(false);
        });
    }, DEBOUNCE_MS);
  };

  const changeQuery = (text: string) => {
    setQuery(text);
    lookup(text);
  };

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

  const current = query.trim().toLowerCase();
  // Previous answers stay on screen while the next one loads (no flicker),
  // but Enter only trusts an answer for exactly what's typed.
  const suggestions = current ? results.players : [];
  const upToDate = results.q === current && !loading;

  const go = (name: string) => {
    if (onPick) {
      onPick(name);
      onQueryChange?.(name);
      changeQuery(name);
      setOpen(false);
      setActive(0);
      return;
    }
    router.push(profileHref(name));
    changeQuery("");
    setOpen(false);
    setActive(0);
    onNavigate?.();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (upToDate && suggestions.length > 0) {
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
              changeQuery(e.target.value);
              setOpen(true);
              setActive(0);
              onQueryChange?.(e.target.value);
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
              {upToDate ? <>No players found for &quot;{query.trim()}&quot;.</> : "Searching…"}
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
                  <AvatarFallback className="bg-hl-panel-light text-[0.6875rem] font-bold text-hl-gold">
                    {p.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-white">
                  <ClubTaggedName name={p.username} tag={p.clubTag} discordUsername={p.discordUsername} />
                </span>
                {p.banned ? <BannedTag /> : null}
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
