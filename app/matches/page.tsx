"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Swords, MapPin, ArrowUpRight, Filter } from "lucide-react";

interface ApiMatch {
  matchId: number;
  date: string;
  map: string;
  region: string;
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapFilter, setMapFilter] = useState("ALL");

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then((data) => setMatches(Array.isArray(data) ? data : []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, []);

  const maps = useMemo(
    () => Array.from(new Set(matches.map((m) => m.map))).sort(),
    [matches]
  );

  const filtered = useMemo(
    () => (mapFilter === "ALL" ? matches : matches.filter((m) => m.map === mapFilter)),
    [matches, mapFilter]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader
        icon={Swords}
        title="Matches"
        subtitle="Every recorded SFHL match"
        actions={
          !loading && matches.length > 0 ? (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-hl-muted" />
              <Select value={mapFilter} onValueChange={(v) => setMapFilter(v ?? "ALL")}>
                <SelectTrigger className="w-[150px] bg-hl-panel border-hl-border text-white text-sm">
                  <SelectValue placeholder="Map" />
                </SelectTrigger>
                <SelectContent className="bg-hl-panel border-hl-border text-white">
                  <SelectItem value="ALL">All maps</SelectItem>
                  {maps.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-hl-panel border-hl-border p-0">
          <EmptyState
            icon={Swords}
            title="No matches found"
            hint={
              matches.length === 0
                ? "No matches have been recorded yet."
                : "No matches on this map. Try a different filter."
            }
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((match) => (
            <Link href={`/match/${match.matchId}`} key={match.matchId}>
              <Card className="bg-hl-panel border-hl-border p-5 card-hover-glow group cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <Badge className="bg-hl-gold/10 text-hl-gold border-hl-gold/30 text-xs">
                    <Swords className="w-3 h-3 mr-1" /> Match
                  </Badge>
                  <span className="text-xs text-hl-muted">{match.date}</span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-hl-gold transition-colors flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-hl-muted" />
                  {match.map}
                </h3>
                <div className="flex items-center justify-between text-sm text-hl-muted">
                  <span>{match.region}</span>
                  <span className="flex items-center gap-1 text-hl-gold group-hover:underline">
                    View scoreboard <ArrowUpRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
