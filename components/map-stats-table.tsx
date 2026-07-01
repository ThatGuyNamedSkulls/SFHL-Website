"use client";

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Match } from "@/types";

interface MapAgg {
  map: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  hsSum: number;
  scoreSum: number;
}

/** Per-map performance table aggregated from a player's match history. */
export function MapStatsTable({ matches }: { matches: Match[] }) {
  const rows = useMemo(() => {
    const acc: Record<string, MapAgg> = {};
    for (const m of matches) {
      const key = m.map || "Unknown";
      if (!acc[key]) {
        acc[key] = { map: key, games: 0, wins: 0, kills: 0, deaths: 0, hsSum: 0, scoreSum: 0 };
      }
      const a = acc[key];
      a.games += 1;
      if (m.result === "W") a.wins += 1;
      a.kills += m.kills;
      a.deaths += m.deaths;
      a.hsSum += m.headshotPercent;
      a.scoreSum += m.score;
    }
    return Object.values(acc).sort((x, y) => y.games - x.games);
  }, [matches]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-hl-border hover:bg-transparent">
            <TableHead className="text-hl-muted text-[10px] header-caps">Map</TableHead>
            <TableHead className="text-hl-muted text-[10px] header-caps text-right">Games</TableHead>
            <TableHead className="text-hl-muted text-[10px] header-caps text-right">Win %</TableHead>
            <TableHead className="text-hl-muted text-[10px] header-caps text-right">K/D</TableHead>
            <TableHead className="text-hl-muted text-[10px] header-caps text-right">HS %</TableHead>
            <TableHead className="text-hl-muted text-[10px] header-caps text-right">Avg Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const winPct = r.games > 0 ? (r.wins / r.games) * 100 : 0;
            const kd = r.deaths > 0 ? r.kills / r.deaths : r.kills;
            const hs = r.games > 0 ? r.hsSum / r.games : 0;
            const avgScore = r.games > 0 ? Math.round(r.scoreSum / r.games) : 0;
            return (
              <TableRow
                key={r.map}
                className="border-hl-border hover:bg-hl-panel-light/50 transition-colors"
              >
                <TableCell className="font-semibold text-white text-sm">{r.map}</TableCell>
                <TableCell className="text-right text-sm text-hl-muted">{r.games}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span className="hidden sm:inline-block w-16 h-1.5 rounded-full bg-hl-base overflow-hidden align-middle">
                      <span
                        className="block h-full bg-hl-green"
                        style={{ width: `${winPct}%` }}
                      />
                    </span>
                    <span className="text-sm text-hl-green font-medium w-10 text-right">
                      {winPct.toFixed(0)}%
                    </span>
                  </span>
                </TableCell>
                <TableCell
                  className={`text-right text-sm font-medium ${
                    kd >= 1 ? "text-hl-teal" : "text-hl-red"
                  }`}
                >
                  {kd.toFixed(2)}
                </TableCell>
                <TableCell className="text-right text-sm text-hl-muted">{hs.toFixed(0)}%</TableCell>
                <TableCell className="text-right text-sm text-hl-gold font-semibold">
                  {avgScore}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
