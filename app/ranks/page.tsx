import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { RankBadge } from "@/components/rank-badge";
import { RANK_TIERS } from "@/data/ranks";
import { Trophy, TrendingUp, Target, Award } from "lucide-react";

export const metadata = {
  title: "Ranks & Elo — SFHL",
  description: "The SFHL rank tiers, Elo ranges, and how ranking works.",
};

export default function RanksPage() {
  // Ladder view: highest tier (★) at the top down to D. Unranked handled separately.
  const ladder = RANK_TIERS.filter((t) => t.letter !== "UNRANKED").slice().reverse();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader
        icon={Trophy}
        title="Ranks & Elo"
        subtitle="How the SFHL ranking system works"
      />

      {/* How it works */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-hl-panel border-hl-border p-5">
          <Target className="w-5 h-5 text-hl-gold mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">Placement</h3>
          <p className="text-xs text-hl-muted leading-relaxed">
            New players play placement matches before receiving a rank. Your starting
            Elo is based on how you perform across those games.
          </p>
        </Card>
        <Card className="bg-hl-panel border-hl-border p-5">
          <TrendingUp className="w-5 h-5 text-hl-gold mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">Gaining Elo</h3>
          <p className="text-xs text-hl-muted leading-relaxed">
            Elo changes with each match based on the result, the round differential, and
            your individual score compared to what&apos;s expected for your tier.
          </p>
        </Card>
        <Card className="bg-hl-panel border-hl-border p-5">
          <Award className="w-5 h-5 text-hl-gold mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">Reaching ★</h3>
          <p className="text-xs text-hl-muted leading-relaxed">
            Climb from D through the A and S tiers. Passing 2500 Elo earns the top
            ★ (Star) rank — the highest tier in SFHL.
          </p>
        </Card>
      </div>

      {/* Tier ladder */}
      <Card className="bg-hl-panel border-hl-border overflow-hidden">
        <div className="px-5 py-4 border-b border-hl-border">
          <h2 className="text-sm font-bold text-white header-caps">Rank Tiers</h2>
        </div>
        <div className="divide-y divide-hl-border">
          {ladder.map((tier) => (
            <div
              key={tier.letter}
              className="flex items-center gap-4 px-5 py-4 hover:bg-hl-panel-light/40 transition-colors"
            >
              <RankBadge rank={tier.letter} size="md" showGlow={false} />
              <div className="flex-1">
                <div className="font-bold text-white">
                  {tier.letter === "STAR" ? "★ Star" : `Tier ${tier.name}`}
                </div>
                <div className="text-xs text-hl-muted">{tier.dbName}</div>
              </div>
              <div className="text-right">
                <div className="stat-number text-hl-gold">
                  {tier.minElo}
                  {tier.letter === "STAR" ? "+" : ` – ${tier.maxElo}`}
                </div>
                <div className="text-[10px] text-hl-muted header-caps">Elo</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-xs text-hl-muted mt-4">
        Unranked players haven&apos;t completed placement yet and don&apos;t appear on the
        leaderboards until they finish.
      </p>
    </div>
  );
}
