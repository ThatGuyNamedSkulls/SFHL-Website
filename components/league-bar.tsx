"use client";

/**
 * League bar (ESEA-style): season chips with LIVE / UPCOMING badges, a ⋮ menu
 * of past seasons, the tabs of the season you're on, and Manage for staff.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreVertical, Settings2 } from "lucide-react";
import type { LeagueTab, SeasonLink } from "@/lib/league-shell";

function Badge({ badge }: { badge: SeasonLink["badge"] }) {
  if (badge === "live") {
    return (
      <span className="rounded-[4px] border border-[#ff5500] bg-[#ff5500]/15 px-1 text-[9px] font-black leading-[14px] text-[#ff5500]">
        LIVE
      </span>
    );
  }
  if (badge === "upcoming") {
    return (
      <span className="rounded-[4px] bg-white/10 px-1 text-[9px] font-black leading-[14px] text-white/80">UPCOMING</span>
    );
  }
  return null;
}

export function LeagueBar({
  seasonId,
  pinned,
  past,
  tabs,
  staff,
}: {
  seasonId: number;
  pinned: SeasonLink[];
  past: SeasonLink[];
  tabs: LeagueTab[];
  staff: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The longest tab href that prefixes the path is the active one (Overview is the base path).
  const active = [...tabs]
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.key;

  return (
    <nav
      aria-label="League navigation"
      className="mb-5 flex flex-wrap items-stretch gap-x-1 border-b border-white/[0.08]"
    >
      <div className="flex shrink-0 items-stretch gap-5">
        {pinned.map((s) => {
          const on = s.id === seasonId;
          return (
            <Link
              key={s.id}
              href={`/league/${s.id}`}
              className={`flex items-center gap-1.5 border-b-2 py-3 text-[13px] font-black uppercase tracking-wide ${
                on ? "border-[#ff5500] text-[#ff5500]" : "border-transparent text-white/80 hover:text-white"
              }`}
            >
              {s.name}
              <Badge badge={s.badge} />
            </Link>
          );
        })}
        {past.length ? (
          <div className="relative flex items-center">
            <button
              type="button"
              aria-label="More seasons"
              onClick={() => setOpen((v) => !v)}
              className={`rounded-md p-1.5 ${open ? "bg-white/10 text-white" : "text-white/70 hover:text-white"}`}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {open ? (
              <>
                <button
                  type="button"
                  aria-label="Close"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-48 overflow-y-auto rounded-lg border border-white/15 bg-[#161616] py-1 shadow-xl">
                  {past.map((s) => (
                    <Link
                      key={s.id}
                      href={`/league/${s.id}`}
                      onClick={() => setOpen(false)}
                      className={`block px-3 py-2 text-sm ${
                        s.id === seasonId ? "text-[#ff5500]" : "text-white/85 hover:bg-white/[0.06]"
                      }`}
                    >
                      {s.name}
                      {s.status === "cancelled" ? <span className="ml-1 text-xs text-white/40">(cancelled)</span> : null}
                    </Link>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mx-3 my-3 hidden w-px shrink-0 bg-white/10 sm:block" />

      <div className="flex w-full min-w-0 items-stretch gap-6 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:w-auto sm:flex-1 sm:[mask-image:none]">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`flex items-center gap-1.5 border-b-2 py-3 text-[13px] font-black uppercase tracking-wide ${
              active === t.key ? "border-[#ff5500] text-[#ff5500]" : "border-transparent text-white/80 hover:text-white"
            }`}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="rounded-full bg-white/10 px-1.5 text-[10px] leading-4 text-white/80">
                {t.count.toLocaleString()}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {staff ? (
        <Link
          href={`/league/manage?season=${seasonId}`}
          className="ml-auto flex shrink-0 items-center gap-1.5 py-3 pl-4 text-[12px] font-bold uppercase tracking-wide text-hl-gold hover:text-white"
        >
          <Settings2 className="h-4 w-4" /> Manage
        </Link>
      ) : null}
    </nav>
  );
}
