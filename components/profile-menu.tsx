"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins, Settings, UserRound, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/logout-button";
import { UserSession } from "@/types";
import { formatUsername } from "@/lib/format";

/** FACEIT-style avatar popover: online, HL Coins, View Profile, Settings. */
export function ProfileMenu({ variant = "bar" }: { variant?: "bar" | "rail" }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [coins, setCoins] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const me = meRes.ok ? await meRes.json() : null;
        if (cancelled) return;
        const user = (me?.user as UserSession | undefined) ?? null;
        setSession(user);
        if (!user?.playerName) {
          setCoins(0);
          return;
        }
        const shopRes = await fetch("/api/shop", { cache: "no-store" });
        const shop = shopRes.ok ? await shopRes.json() : null;
        if (!cancelled) setCoins(typeof shop?.coins === "number" ? shop.coins : 0);
      } catch {
        /* ignore */
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const profileHref = session
    ? `/profile?player=${encodeURIComponent(session.playerName || session.username)}`
    : "/login";
  const label = session
    ? formatUsername(session.username, session.discordUsername)
    : "Log in";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-hl-gold"
      >
        <Avatar className="w-8 h-8 border border-hl-border">
          {session?.avatar ? <AvatarImage src={session.avatar} /> : null}
          <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
            {(session?.username ?? "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {session && (
          <span
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-hl-green border-2 ${
              variant === "rail" ? "border-[#181818]" : "border-[#111]"
            }`}
          />
        )}
      </button>

      {open && (
        <div
          className={`absolute w-[280px] rounded-xl border border-hl-border bg-[#1c1c1c] shadow-2xl z-[80] overflow-hidden ${
            variant === "rail"
              ? "right-[calc(100%+8px)] top-0"
              : "right-0 top-[calc(100%+10px)]"
          }`}
        >
          {session ? (
            <>
              <div className="px-4 pt-4 pb-3 flex items-center gap-3">
                <Avatar className="w-10 h-10 border border-hl-border">
                  {session.avatar ? <AvatarImage src={session.avatar} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                    {session.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white truncate">{label}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-hl-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-hl-green" />
                    Online
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 text-[#8a8a8a] hover:text-white shrink-0"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                <Link
                  href="/shop"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-hl-border bg-hl-base/60 px-3 py-2 hover:border-hl-gold/40"
                >
                  <div className="flex items-center gap-1 text-[10px] header-caps text-hl-muted">
                    <Coins className="w-3 h-3 text-hl-gold" /> Shop
                  </div>
                  <div className="stat-number text-white font-black mt-0.5">{coins.toLocaleString()}</div>
                </Link>
                <Link
                  href="/shop"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-hl-border bg-hl-base/60 px-3 py-2 hover:border-hl-gold/40"
                >
                  <div className="text-[10px] header-caps text-hl-muted">HL Coins</div>
                  <div className="text-xs font-bold text-hl-gold mt-0.5">Buy</div>
                </Link>
              </div>

              <div className="px-3 pb-3">
                <Link
                  href={profileHref}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center h-9 rounded-md border border-hl-gold text-hl-gold text-xs font-black header-caps hover:bg-hl-gold/10"
                >
                  View Profile
                </Link>
              </div>

              <div className="border-t border-hl-border py-1">
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-white hover:bg-hl-panel-light/50"
                >
                  <Settings className="w-4 h-4 text-hl-muted" />
                  Account Settings
                </Link>
                <LogoutButton
                  onBeforeLogout={() => setOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-hl-muted hover:text-white hover:bg-hl-panel-light/50 text-left"
                >
                  Log out
                </LogoutButton>
              </div>
            </>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-white">
                <UserRound className="w-4 h-4 text-hl-muted" />
                Not signed in
              </div>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center h-9 rounded-md bg-gold-gradient text-hl-base text-xs font-black header-caps"
              >
                Log in with Discord
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
