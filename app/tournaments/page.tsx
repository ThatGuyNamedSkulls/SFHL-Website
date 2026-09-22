"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { TournamentCreateForm } from "@/components/tournament-create-form";
import { regionMeta } from "@/lib/regions";
import { Swords, Trophy } from "lucide-react";

interface CupCard {
  id: string;
  name: string;
  kind: "official" | "community";
  region: string;
  bracket: "single" | "double";
  size: number;
  bo: number;
  entryFee: number;
  pot: number;
  status: "open" | "live" | "completed" | "cancelled";
  teamCount: number;
}

function formatLabel(cup: CupCard) {
  const elim = cup.bracket === "double" ? "Double elim" : "Single elim";
  return `${elim} · BO${cup.bo}`;
}

export default function TournamentsPage() {
  const [cups, setCups] = useState<CupCard[]>([]);
  const [staff, setStaff] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/tournaments");
    const data = await res.json().catch(() => ({}));
    setCups(Array.isArray(data.tournaments) ? data.tournaments : []);
    setStaff(!!data.staff);
  }, []);

  useEffect(() => {
    load().catch(() => setCups([]));
  }, [load]);

  const visible = cups.filter((cup) => cup.status !== "cancelled");

  return (
    <div className="hl-page-wide">
      <PageHeader
        icon={Swords}
        title="Tournaments"
        subtitle="Official cups and club cups. Results do not change ranked Elo."
        className="mb-6"
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-hl-muted max-w-xl">
          Match Staff open official cups. Club owners open community cups from their club page.
          Captains build a roster of 5 starters and 2 subs.
        </p>
        {staff ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="h-10 rounded-xl bg-gold-gradient px-4 text-sm font-black text-hl-base"
          >
            {creating ? "Close" : "Create cup"}
          </button>
        ) : null}
      </div>

      {creating && staff ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-6">
          <TournamentCreateForm
            kind="official"
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              window.location.href = `/tournaments/${id}`;
            }}
          />
        </Card>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No cups yet"
          hint="When Match Staff or a club owner opens one, it will show up here."
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {visible.map((cup) => (
            <Link key={cup.id} href={`/tournaments/${cup.id}`} className="block">
              <Card className="bg-hl-panel border-hl-border p-5 card-hover-glow relative overflow-hidden h-full">
                <div
                  className={`absolute top-0 left-0 right-0 h-1 ${
                    cup.status === "live"
                      ? "bg-hl-red"
                      : cup.status === "open"
                        ? "bg-hl-teal"
                        : "bg-hl-muted/30"
                  }`}
                />
                <div className="flex items-start justify-between gap-3 mt-1">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-white truncate">{cup.name}</h3>
                    <div className="mt-1 text-xs text-hl-muted">
                      {cup.kind === "official" ? "Official" : "Club cup"} · {regionMeta(cup.region).short} ·{" "}
                      {cup.status.toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-black text-hl-gold">{cup.pot.toLocaleString()}</div>
                    <div className="text-[11px] text-hl-muted">Pot</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-hl-muted">
                  <span>
                    {cup.teamCount}/{cup.size} teams
                  </span>
                  <span>{formatLabel(cup)}</span>
                  <span>Entry {cup.entryFee.toLocaleString()}</span>
                  <span>{cup.status === "open" ? "Registration open" : cup.status}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
