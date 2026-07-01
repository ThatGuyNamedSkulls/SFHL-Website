"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TOURNAMENTS } from "@/data/tournaments";
import { BRACKETS } from "@/data/brackets";
import { BracketView } from "@/components/bracket-view";
import { Swords, Trophy, Users, MapPin, Calendar, Flame, Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default function TournamentsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader
        icon={Swords}
        title="Tournaments"
        subtitle="Organized SFHL cups and leagues"
        className="mb-6"
      />

      {/* Preview notice */}
      <div className="mb-8 flex items-start gap-3 rounded-xl border border-hl-gold/30 bg-hl-gold/10 px-4 py-3">
        <Info className="w-5 h-5 text-hl-gold shrink-0 mt-0.5" />
        <p className="text-sm text-hl-muted">
          <span className="text-hl-gold font-semibold">Preview:</span>{" "}
          Tournaments aren&apos;t running through the site yet. The cups below are
          a preview of how brackets and results will look once the feature goes
          live.
        </p>
      </div>

      {/* Tournament list */}
      <div className="grid md:grid-cols-2 gap-4">
        {TOURNAMENTS.map((tournament) => (
          <Card
            key={tournament.id}
            className="bg-hl-panel border-hl-border p-6 card-hover-glow group relative overflow-hidden"
          >
            {/* Status indicator line */}
            <div
              className={`absolute top-0 left-0 right-0 h-1 ${
                tournament.status === "live"
                  ? "bg-hl-red"
                  : tournament.status === "upcoming"
                  ? "bg-hl-teal"
                  : "bg-hl-muted/30"
              }`}
            />

            <div className="flex items-start justify-between mb-4 mt-1">
              <div>
                <h3 className="text-lg font-bold text-white group-hover:text-hl-gold transition-colors">
                  {tournament.name}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    className={`text-xs font-bold px-2 py-0.5 border-0 ${
                      tournament.status === "live"
                        ? "bg-hl-red/15 text-hl-red"
                        : tournament.status === "upcoming"
                        ? "bg-hl-teal/15 text-hl-teal"
                        : "bg-hl-muted/15 text-hl-muted"
                    }`}
                  >
                    {tournament.status === "live" && (
                      <Flame className="w-3 h-3 mr-1" />
                    )}
                    {tournament.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-hl-muted">
                    {tournament.region}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-hl-gold">
                  {tournament.prizePool}
                </div>
                <div className="text-xs text-hl-muted">Prize Pool</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-hl-muted">
                <Users className="w-4 h-4" />
                <span>
                  {tournament.teams}/{tournament.maxTeams} Teams
                </span>
              </div>
              <div className="flex items-center gap-2 text-hl-muted">
                <Trophy className="w-4 h-4" />
                <span>{tournament.format}</span>
              </div>
              <div className="flex items-center gap-2 text-hl-muted">
                <Calendar className="w-4 h-4" />
                <span>
                  {new Date(tournament.startDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-hl-muted">
                <MapPin className="w-4 h-4" />
                <span>{tournament.mapPool.length} Maps</span>
              </div>
            </div>

            {/* Map pool */}
            <div className="mt-4 pt-3 border-t border-hl-border">
              <div className="text-xs text-hl-muted header-caps mb-2">
                Map Pool
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tournament.mapPool.map((map) => (
                  <span
                    key={map}
                    className="text-xs px-2 py-0.5 rounded bg-hl-panel-light text-hl-muted border border-hl-border"
                  >
                    {map}
                  </span>
                ))}
              </div>
            </div>

            {/* Bracket view */}
            {tournament.status !== "completed" && BRACKETS[tournament.id] && (
              <div className="mt-4 pt-3 border-t border-hl-border overflow-hidden">
                <div className="text-xs text-hl-muted header-caps mb-2">
                  Bracket
                </div>
                <div className="bg-hl-base/30 rounded-lg border border-hl-border p-2">
                    <BracketView bracket={BRACKETS[tournament.id]} />
                </div>
              </div>
            )}
            {tournament.status === "completed" && BRACKETS[tournament.id] && (
               <div className="mt-4 pt-3 border-t border-hl-border overflow-hidden">
                 <div className="text-xs text-hl-muted header-caps mb-2">
                   Final Bracket
                 </div>
                 <div className="bg-hl-base/30 rounded-lg border border-hl-border p-2">
                     <BracketView bracket={BRACKETS[tournament.id]} />
                 </div>
               </div>
            )}
            {tournament.status !== "completed" && !BRACKETS[tournament.id] && (
               <div className="mt-4 pt-3 border-t border-hl-border">
                 <div className="flex items-center justify-center py-3 text-xs text-hl-muted bg-hl-base/40 rounded-lg border border-dashed border-hl-border">
                   <Swords className="w-4 h-4 mr-2" />
                   Bracket forming...
                 </div>
               </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
