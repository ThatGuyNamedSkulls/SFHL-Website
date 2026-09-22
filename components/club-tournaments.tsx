"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { TournamentCreateForm } from "@/components/tournament-create-form";
import { Trophy } from "lucide-react";

interface CupRow {
  id: string;
  name: string;
  kind: "official" | "community";
  status: string;
  teamCount: number;
  size: number;
  teams: { id: string; name: string; seed: number; placement: number | null }[];
}

export function ClubTournaments({ clubId, owner }: { clubId: string; owner: boolean }) {
  const [cups, setCups] = useState<CupRow[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tournaments?clubId=${encodeURIComponent(clubId)}`);
    const data = await res.json().catch(() => ({}));
    setCups(Array.isArray(data.tournaments) ? data.tournaments : []);
  }, [clubId]);

  useEffect(() => {
    load().catch(() => setCups([]));
  }, [load]);

  return (
    <Card className="bg-hl-panel border-hl-border p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-white header-caps flex items-center gap-2">
          <Trophy className="w-4 h-4 text-hl-gold" /> Current tournaments
        </h2>
        {owner ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="text-xs font-bold text-hl-gold hover:underline"
          >
            {creating ? "Close" : "Create club cup"}
          </button>
        ) : null}
      </div>
      {creating && owner ? (
        <div className="mb-4">
          <TournamentCreateForm
            kind="community"
            clubId={clubId}
            onCancel={() => setCreating(false)}
            onCreated={(cupId) => {
              window.location.href = `/tournaments/${cupId}`;
            }}
          />
        </div>
      ) : null}
      {cups.length === 0 ? (
        <p className="text-sm text-hl-muted">No cups for this club right now.</p>
      ) : (
        <div className="space-y-3">
          {cups.map((cup) => (
            <div key={cup.id} className="rounded-lg border border-hl-border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/tournaments/${cup.id}`} className="font-bold text-white hover:text-hl-gold">
                  {cup.name}
                </Link>
                <span className="text-[11px] font-bold uppercase text-hl-muted">
                  {cup.kind === "official" ? "Official" : "Club"} · {cup.status} · {cup.teamCount}/{cup.size}
                </span>
              </div>
              {cup.teams.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cup.teams.map((team) => (
                    <span key={team.id} className="rounded bg-hl-base border border-hl-border px-2 py-0.5 text-xs text-white">
                      {team.placement ? `#${team.placement} ` : team.seed ? `#${team.seed} ` : ""}
                      {team.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-hl-muted">Teams have not been locked in yet.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
