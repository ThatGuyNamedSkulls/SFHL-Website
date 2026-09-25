/**
 * FACEIT-style player card (docs/LEAGUE_V2_PLAN.md D1): the equipped profile
 * card as a banner, a round avatar in a ring of the rank's colour (filled by
 * progress through the rank), a crown for the captain, "[TAG] name", the
 * linked tick, the flag, and the level badge with Elo. "lg" on the upcoming
 * Overview, "sm" on the Find pages. Server-safe (no hooks).
 */
import { BadgeCheck, Crown, UserRound } from "lucide-react";
import { Flag } from "@/components/flag";
import { RankBadge } from "@/components/rank-badge";
import { countryName, flagPath } from "@/lib/countries";
import type { PlayerCardData } from "@/lib/player-card";

const SIZES = {
  lg: { card: "w-[136px] h-[228px]", banner: "h-[78px]", ring: 70, pad: 3, name: "text-[12px]", badge: "md" as const, elo: "text-[11px]" },
  md: { card: "w-[118px] h-[198px]", banner: "h-[64px]", ring: 58, pad: 3, name: "text-[11px]", badge: "md" as const, elo: "text-[10px]" },
  sm: { card: "w-[96px] h-[158px]", banner: "h-[50px]", ring: 48, pad: 2, name: "text-[10px]", badge: "sm" as const, elo: "text-[10px]" },
};

function Chip({ children, tone }: { children: React.ReactNode; tone: "orange" | "dark" }) {
  return (
    <span
      className={`rounded px-1.5 text-[9px] font-black leading-4 ${tone === "orange" ? "bg-[#ff5500] text-white" : "bg-black/70 text-white/85"}`}
    >
      {children}
    </span>
  );
}

export function PlayerCard({
  card,
  size = "lg",
  highlight = false,
  emptyLabel = "Open spot",
}: {
  card: PlayerCardData | null;
  size?: keyof typeof SIZES;
  /** Orange border (the viewer's card). */
  highlight?: boolean;
  emptyLabel?: string;
}) {
  const s = SIZES[size];
  const ring = card
    ? `conic-gradient(${card.ringColor} ${Math.round(card.progress * 360)}deg, rgba(255,255,255,0.12) 0deg)`
    : "rgba(255,255,255,0.08)";
  return (
    <div
      className={`relative flex ${s.card} shrink-0 flex-col overflow-hidden rounded-xl border bg-[#141414] shadow-[0_18px_40px_rgba(0,0,0,0.5)] ${
        highlight ? "border-[#ff5500]/80" : "border-white/[0.1]"
      }`}
    >
      {/* Banner: the equipped profile card, or a plain gradient. */}
      <div className={`relative ${s.banner} w-full shrink-0 overflow-hidden`}>
        {card?.cardArt ? (
          // eslint-disable-next-line @next/next/no-img-element -- cosmetic asset
          <img src={card.cardArt} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className={`h-full w-full ${
              card ? "bg-[radial-gradient(circle_at_30%_20%,rgba(255,85,0,0.45),transparent_60%),linear-gradient(135deg,#2a2a2a,#161616)]" : "bg-[#1b1b1b]"
            }`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#141414]" />
        {card ? (
          <div className="absolute left-1.5 top-1.5 flex gap-1">
            {card.me ? <Chip tone="orange">YOU</Chip> : null}
            {card.sub ? <Chip tone="dark">SUB</Chip> : null}
            {card.coach ? <Chip tone="dark">COACH</Chip> : null}
          </div>
        ) : null}
      </div>

      {/* Avatar in its rank ring, overlapping the banner. */}
      <div className="relative flex justify-center" style={{ marginTop: -s.ring / 2 }}>
        {card?.captain ? (
          <Crown className="absolute -top-3.5 left-1/2 z-10 h-4 w-4 -translate-x-1/2 text-hl-gold drop-shadow" aria-label="Captain" />
        ) : null}
        <span
          className="grid place-items-center rounded-full"
          style={{ width: s.ring, height: s.ring, padding: s.pad, background: ring }}
          title={card ? `${card.rank === "UNRANKED" ? "Unranked" : card.rank} · ${Math.round(card.progress * 100)}% through the rank` : undefined}
        >
          <span className="grid h-full w-full place-items-center overflow-hidden rounded-full border-2 border-[#141414] bg-[#222]">
            {card?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- Roblox/Discord avatar CDNs
              <img src={card.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <UserRound className={`h-1/2 w-1/2 ${card ? "text-[#ff5500]/80" : "text-white/15"}`} strokeWidth={1.5} />
            )}
          </span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center px-1.5 pb-2 pt-1.5 text-center">
        <div className={`flex max-w-full items-center justify-center gap-0.5 font-black ${s.name} ${card ? "text-white" : "text-white/35"}`}>
          <span className="truncate">
            {card?.tag ? <span className="text-[#ff5500]">[{card.tag}] </span> : null}
            {card ? card.name : emptyLabel}
          </span>
          {card?.verified ? <BadgeCheck className="h-3 w-3 shrink-0 text-hl-green" aria-label="Linked HyperLeague player" /> : null}
        </div>
        {card?.country ? (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase text-white/55">
            <Flag src={flagPath(card.country)} name={countryName(card.country)} className="h-2.5 w-3.5" />
            {card.country}
          </span>
        ) : null}
        <div className="mt-auto flex flex-col items-center gap-0.5">
          {card ? <RankBadge rank={card.rank} size={s.badge} showGlow={false} /> : null}
          <span className={`${s.elo} tabular-nums text-white/60`}>
            {card ? (card.elo !== null ? `${card.elo.toLocaleString("en-US")} Elo` : "Unranked") : " "}
          </span>
        </div>
      </div>
    </div>
  );
}
