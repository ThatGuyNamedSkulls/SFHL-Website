"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { TournamentCreateForm } from "@/components/tournament-create-form";
import { regionMeta } from "@/lib/regions";
import { Coins, Search, Swords, Trophy, Users } from "lucide-react";

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

function statusMeta(status: CupCard["status"]) {
  if (status === "live") return { label: "Live", bar: "bg-hl-red", pill: "bg-hl-red/15 text-hl-red border-hl-red/40" };
  if (status === "open") return { label: "Open", bar: "bg-hl-teal", pill: "bg-hl-teal/15 text-hl-teal border-hl-teal/40" };
  return { label: "Finished", bar: "bg-hl-muted/40", pill: "bg-hl-base text-hl-muted border-hl-border" };
}

function CupTile({ cup }: { cup: CupCard }) {
  const meta = statusMeta(cup.status);
  const filled = cup.size > 0 ? Math.min(100, Math.round((cup.teamCount / cup.size) * 100)) : 0;
  const elim = cup.bracket === "double" ? "Double elimination" : "Single elimination";
  return (
    <Link href={`/tournaments/${cup.id}`} className="block h-full">
      <Card className="bg-hl-panel border-hl-border p-0 card-hover-glow relative overflow-hidden h-full">
        <div className={`h-1 ${meta.bar}`} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.pill}`}>
                  {meta.label}
                </span>
                <span className="rounded-full border border-hl-border bg-hl-base px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hl-muted">
                  {cup.kind === "official" ? "Official" : "Club cup"}
                </span>
              </div>
              <h3 className="text-lg font-black text-white truncate">{cup.name}</h3>
              <p className="mt-1 text-xs text-hl-muted">
                {regionMeta(cup.region).label} · {elim}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-black text-hl-gold tabular-nums">{cup.pot.toLocaleString()}</div>
              <div className="text-[11px] text-hl-muted">Pot</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-hl-muted">
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {cup.teamCount}/{cup.size} teams
              </span>
              <span>BO{cup.bo}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-hl-base">
              <div className="h-full bg-gold-gradient" style={{ width: `${filled}%` }} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-hl-muted">
            <span className="inline-flex items-center gap-1">
              <Coins className="w-3.5 h-3.5 text-hl-gold" />
              Entry {cup.entryFee.toLocaleString()}
            </span>
            <span className="font-bold text-hl-gold">View bracket</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function TournamentsPage() {
  const [cups, setCups] = useState<CupCard[]>([]);
  const [staff, setStaff] = useState(false);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"all" | "official" | "community">("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/tournaments");
    const data = await res.json().catch(() => ({}));
    setCups(Array.isArray(data.tournaments) ? data.tournaments : []);
    setStaff(!!data.staff);
  }, []);

  useEffect(() => {
    load().catch(() => setCups([]));
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cups.filter((cup) => {
      if (cup.status === "cancelled") return false;
      if (kind !== "all" && cup.kind !== kind) return false;
      if (q && !cup.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cups, kind, query]);

  const live = visible.filter((cup) => cup.status === "live");
  const open = visible.filter((cup) => cup.status === "open");
  const done = visible.filter((cup) => cup.status === "completed");
  const listed = cups.filter((cup) => cup.status !== "cancelled");
  const pot = listed.reduce((sum, cup) => sum + (cup.status === "completed" ? 0 : cup.pot), 0);

  const sections = [
    { key: "live" as const, title: "Live now", rows: live },
    { key: "open" as const, title: "Registration open", rows: open },
    { key: "completed" as const, title: "Finished", rows: done },
  ].filter((section) => section.rows.length > 0);

  return (
    <div className="hl-page-wide">
      <PageHeader
        icon={Swords}
        title="Tournaments"
        subtitle="Official cups and club cups. Results do not change ranked Elo."
        className="mb-6"
        actions={
          staff ? (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="h-10 rounded-xl bg-gold-gradient px-4 text-sm font-black text-hl-base"
            >
              {creating ? "Close" : "Create cup"}
            </button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Live", value: String(listed.filter((c) => c.status === "live").length) },
          { label: "Open", value: String(listed.filter((c) => c.status === "open").length) },
          { label: "Open pots", value: pot.toLocaleString() },
        ].map((stat) => (
          <Card key={stat.label} className="bg-hl-panel border-hl-border px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-hl-muted">{stat.label}</div>
            <div className="mt-1 text-2xl font-black text-white tabular-nums">{stat.value}</div>
          </Card>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hl-muted pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cups"
            className="h-10 w-full rounded-lg border border-hl-border bg-hl-base pl-9 pr-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
        </div>
        {(
          [
            ["all", "All"],
            ["official", "Official"],
            ["community", "Club"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setKind(id)}
            className={`h-10 rounded-lg border px-3 text-xs font-bold ${
              kind === id
                ? "border-hl-gold/50 bg-hl-gold/10 text-hl-gold"
                : "border-hl-border text-hl-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
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
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="mb-3 text-sm font-bold text-white header-caps">{section.title}</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {section.rows.map((cup) => (
                  <CupTile key={cup.id} cup={cup} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
