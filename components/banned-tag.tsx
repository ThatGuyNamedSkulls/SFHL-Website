import { Ban } from "lucide-react";

const SIZES = {
  sm: { box: "gap-0.5 px-1 py-px text-[0.625rem]", icon: "h-2.5 w-2.5" }, // leaderboard and search rows
  md: { box: "gap-1 px-1.5 py-0.5 text-[0.6875rem]", icon: "h-3 w-3" },   // profile header
} as const;

/**
 * The red "Banned" tag beside a name: the account has an active /player ban
 * (lib/bans.ts). It's a matchmaking ban, not a Discord one; the reason stays
 * in the staff panel.
 */
export function BannedTag({ size = "sm", className = "" }: { size?: keyof typeof SIZES; className?: string }) {
  const { box, icon } = SIZES[size];
  return (
    <span
      title="Banned from HyperLeague matchmaking"
      className={`inline-flex shrink-0 items-center rounded border border-hl-red/40 bg-hl-red/10 font-black uppercase leading-none tracking-[0.06em] text-hl-red ${box} ${className}`}
    >
      <Ban className={icon} aria-hidden />
      Banned
    </span>
  );
}
