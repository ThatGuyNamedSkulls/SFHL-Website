"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PartyCard } from "@/components/party-card";
import { CreatePartyModal } from "@/components/create-party-modal";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { UserSession, PartyView } from "@/types";
import { Users, Plus, Filter } from "lucide-react";

function PartyFinderContent() {
  const searchParams = useSearchParams();
  const [parties, setParties] = useState<PartyView[]>([]);
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [gameFilter, setGameFilter] = useState("All");
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [joinableOnly, setJoinableOnly] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/parties");
      const data = await res.json();
      setParties(data.parties || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user ?? null))
      .catch(() => { });
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  // Open the create modal when arriving via the sidebar "Create" link.
  useEffect(() => {
    if (searchParams.get("create") === "1") setCreateOpen(true);
  }, [searchParams]);

  const filtered = useMemo(() => {
    return parties.filter((p) => {
      if (gameFilter !== "All" && p.game !== gameFilter) return false;
      if (premiumOnly && p.matchType !== "Premium") return false;
      if (joinableOnly && p.members.length >= p.maxSize) return false;
      return true;
    });
  }, [parties, gameFilter, premiumOnly, joinableOnly]);

  const handleJoin = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/parties/${id}/join`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.party) {
        setParties((prev) => prev.map((p) => (p.id === id ? data.party : p)));
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/parties/${id}/leave`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) setParties(data.parties || []);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader icon={Users} title="Party Finder" subtitle="Find teammates and squad up before you queue" />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={gameFilter}
          onChange={(e) => setGameFilter(e.target.value)}
          className="bg-hl-panel border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50"
        >
          <option value="All">All games</option>
          <option value="Blox Strike">Blox Strike</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-white cursor-pointer bg-hl-panel border border-hl-border rounded-lg px-3 py-2">
          <input type="checkbox" checked={premiumOnly} onChange={(e) => setPremiumOnly(e.target.checked)} className="accent-hl-gold" />
          Premium
        </label>

        <label className="flex items-center gap-2 text-sm text-white cursor-pointer bg-hl-panel border border-hl-border rounded-lg px-3 py-2">
          <input type="checkbox" checked={joinableOnly} onChange={(e) => setJoinableOnly(e.target.checked)} className="accent-hl-gold" />
          Joinable
        </label>

        <span className="flex items-center gap-1.5 text-xs text-hl-muted">
          <Filter className="w-3.5 h-3.5" />
          {filtered.length} part{filtered.length === 1 ? "y" : "ies"}
        </span>

        <button
          onClick={() => setCreateOpen(true)}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" /> Create
        </button>
      </div>

      {/* Party list */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="party-card p-4 h-48 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No open parties"
          hint="Be the first — create a party and invite teammates to queue together."
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((party) => (
            <PartyCard
              key={party.id}
              party={party}
              currentUserId={session?.discordId}
              onJoin={handleJoin}
              onLeave={handleLeave}
              busy={busyId === party.id}
            />
          ))}
        </div>
      )}

      <CreatePartyModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        session={session}
        onCreated={(party) => setParties((prev) => [party, ...prev.filter((p) => p.id !== party.id)])}
      />
    </div>
  );
}

export default function PartyFinderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-hl-muted">Loading…</div>}>
      <PartyFinderContent />
    </Suspense>
  );
}
