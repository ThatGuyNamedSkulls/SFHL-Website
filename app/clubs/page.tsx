"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { Building2, Users } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { QUEUE_REGIONS, regionMeta } from "@/lib/regions";

interface ClubRow {
  id: string;
  name: string;
  description: string;
  region: string;
  ownerName: string;
  memberCount: number;
}

export default function ClubsPage() {
  const { session, loaded } = useSession();
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [region, setRegion] = useState(QUEUE_REGIONS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/clubs");
      const data = await res.json();
      setClubs(Array.isArray(data.clubs) ? data.clubs : []);
    } catch {
      setClubs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/clubs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, region, rules }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create club");
        return;
      }
      setName("");
      setDescription("");
      setRules("");
      await load();
    } catch {
      setError("Could not create club");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hl-page">
      <PageHeader
        icon={Building2}
        title="Clubs"
        subtitle="Open communities with their own rules. Anyone can create or join."
      />

      <Card className="bg-hl-panel border-hl-border p-4 md:p-5 mb-6">
        <div className="text-xs header-caps text-hl-muted mb-3">Create a club</div>
        {loaded && !session ? (
          <p className="text-sm text-hl-muted">
            <Link href="/login" className="text-hl-gold font-bold hover:underline">
              Log in
            </Link>{" "}
            to create or join a club.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 40))}
                placeholder="Club name"
                className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
              />
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as typeof region)}
                className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white focus:outline-none focus:border-hl-gold/50"
              >
                {QUEUE_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 280))}
              placeholder="Short description"
              className="w-full h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
            />
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="Club rules (optional)"
              className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
            />
            <div className="flex items-center justify-between gap-3">
              {error ? <p className="text-sm text-hl-red">{error}</p> : <span />}
              <button
                type="button"
                onClick={create}
                disabled={busy || name.trim().length < 3}
                className="find-match-btn h-10 rounded-xl px-5 text-sm font-black header-caps text-hl-base disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}
      </Card>

      {clubs.length === 0 ? (
        <EmptyState icon={Building2} title="No clubs yet" hint="Be the first to start one." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {clubs.map((club) => (
            <Link
              key={club.id}
              href={`/clubs/${club.id}`}
              className="block rounded-xl border border-hl-border bg-hl-panel p-4 hover:border-hl-gold/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white truncate">{club.name}</h2>
                  <p className="mt-1 text-sm text-hl-muted line-clamp-2">
                    {club.description || "No description yet."}
                  </p>
                </div>
                <span className="text-[11px] font-bold header-caps text-hl-muted shrink-0">
                  {regionMeta(club.region).short}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-hl-muted">
                <Users className="w-3.5 h-3.5" />
                {club.memberCount} {club.memberCount === 1 ? "member" : "members"} · Owner{" "}
                {club.ownerName}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
