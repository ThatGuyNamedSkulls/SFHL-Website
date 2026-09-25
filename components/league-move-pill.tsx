import { ChevronsDown, ChevronsUp } from "lucide-react";
import { LEVEL_NAMES } from "@/lib/league-standings";

/** Promotion / relegation of a team at season end (league v2). `to` "" = back to its Open skill band. */
export function MovePill({ movement, to, compact = false }: { movement: "up" | "down"; to: string; compact?: boolean }) {
  const up = movement === "up";
  const name = LEVEL_NAMES[to] ?? to;
  const label = up ? `Promoted to ${name}` : to ? `Relegated to ${name}` : "Lost Open 10 status";
  return (
    <span
      title={compact ? label : undefined}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-black ${
        up ? "border-hl-green/40 bg-hl-green/10 text-hl-green" : "border-hl-red/40 bg-hl-red/10 text-hl-red"
      }`}
    >
      {up ? <ChevronsUp className="h-3.5 w-3.5" /> : <ChevronsDown className="h-3.5 w-3.5" />}
      {compact ? (to ? name : "Open 10 lost") : label}
    </span>
  );
}
