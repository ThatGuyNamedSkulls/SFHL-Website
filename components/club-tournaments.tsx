"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { TournamentCreateForm } from "@/components/tournament-create-form";
import { CupFacts } from "@/components/cup-facts";

interface CupRow {
  id: string;
  name: string;
  kind: "official" | "community";
  status: string;
  teamCount: number;
  size: number;
  teams: { id: string; name: string; seed: number; placement: number | null }[];
}

export function ClubTournaments({
  clubId,
  owner,
  region,
  rules,
}: {
  clubId: string;
  owner: boolean;
  region: string;
  rules: string;
}) {
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-white">Clan tournaments</h2>
        {owner ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="text-xs font-bold text-[#ff5500] hover:underline"
          >
            {creating ? "Close" : "+ Create"}
          </button>
        ) : null}
      </div>
      {creating && owner ? (
        <Card className="bg-hl-panel border-hl-border p-4">
          <TournamentCreateForm
            kind="community"
            clubId={clubId}
            onCancel={() => setCreating(false)}
            onCreated={(cupId) => {
              window.location.href = `/tournaments/${cupId}`;
            }}
          />
        </Card>
      ) : null}
      <CupFacts region={region} rules={rules} />
      {cups.length === 0 ? (
        <p className="text-sm text-hl-muted">This clan has not created a tournament yet.</p>
      ) : (
        <div className="space-y-3">
          {cups.map((cup) => (
            <div key={cup.id} className="rounded-xl border border-hl-border bg-hl-base px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/tournaments/${cup.id}`} className="font-bold text-white hover:text-hl-gold">
                  {cup.name}
                </Link>
                <span className="rounded-full border border-hl-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hl-muted">
                  {cup.status} · {cup.teamCount}/{cup.size}
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
    </div>
  );
}
