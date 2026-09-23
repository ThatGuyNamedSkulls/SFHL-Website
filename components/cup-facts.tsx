import { regionMeta } from "@/lib/regions";
import { Crown, Crosshair, Gauge, MapPin, Swords, Users, type LucideIcon } from "lucide-react";

/** Club-cup facts. Join type stays off the page (cups are team-only) and
 *  anti-cheat is not part of this league. */
export function CupFacts({
  region,
  rules,
}: {
  region: string;
  rules?: string;
}) {
  return (
    <div className="space-y-8 text-sm">
      <div className="grid gap-6 sm:grid-cols-3">
        <Fact icon={Crosshair} label="Game" value="Strike Force" />
        <Fact icon={MapPin} label="Region" value={regionMeta(region).label || region || "EU"} />
        <Fact icon={Gauge} label="Skill level" value="Any" />
      </div>
      <div>
        <div className="mb-4 text-sm font-bold text-white">Match settings</div>
        <div className="grid gap-6 sm:grid-cols-3">
          <Fact icon={Users} label="Game mode" value="5v5" />
          <Fact icon={Swords} label="Affects Elo" value="No" />
          <Fact icon={Crown} label="Captain selection" value="Random" />
        </div>
      </div>
      <div>
        <div className="mb-1 text-sm font-bold text-white">Rules</div>
        <p className="whitespace-pre-wrap text-sm text-[#a0a0a0]">
          {rules?.trim() || "The default competition rules apply."}
        </p>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-white" strokeWidth={1.75} />
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">{label}</div>
        <div className="mt-0.5 font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}
