"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PartyCard, FriendOption } from "@/components/party-card";
import { CreatePartyModal, PARTY_VIBES } from "@/components/create-party-modal";
import { EmptyState } from "@/components/empty-state";
import { UserSession, PartyView } from "@/types";
import { RANK_TIERS } from "@/data/ranks";
import { Users, Plus, Filter, ShieldCheck, Mic } from "lucide-react";

const SKILL_TIERS = RANK_TIERS.filter((t) => t.letter !== "UNRANKED");
const tierIdx = (letter: string) => SKILL_TIERS.findIndex((t) => t.letter === letter);

interface AdvFilters {
  verified: boolean;
  voice: boolean;
  vibe: string | null;
  minSkill: string;
  maxSkill: string;
  language: string;
  country: string;
}

const DEFAULT_ADV: AdvFilters = {
  verified: false,
  voice: false,
  vibe: null,
  minSkill: "D",
  maxSkill: "STAR",
  language: "All",
  country: "All",
};

const SELECT_CLS =
  "w-full bg-hl-base border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50 transition-colors";

/** FACEIT-style Filters dialog: chips + skill range + language/country. */
function FiltersModal({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: AdvFilters;
  onApply: (f: AdvFilters) => void;
}) {
  const [draft, setDraft] = useState<AdvFilters>(value);

  // Re-seed the draft each time the modal opens with the committed filters.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
      active ? "bg-gold-gradient text-hl-base border-transparent" : "border-hl-border text-hl-muted hover:text-white"
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-hl-panel border border-hl-border sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-white text-center">Filters</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="text-[11px] header-caps text-hl-muted mb-2">Specifics</div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className={chip(draft.verified)} onClick={() => setDraft({ ...draft, verified: !draft.verified })}>
                <ShieldCheck className="w-3.5 h-3.5" /> Verified
              </button>
              <button className={chip(draft.voice)} onClick={() => setDraft({ ...draft, voice: !draft.voice })}>
                <Mic className="w-3.5 h-3.5" /> Voice
              </button>
            </div>
          </div>

          <div>
            <div className="text-[11px] header-caps text-hl-muted mb-2">Vibe</div>
            <div className="flex items-center gap-2 flex-wrap">
              {PARTY_VIBES.map((v) => (
                <button
                  key={v}
                  className={chip(draft.vibe === v)}
                  onClick={() => setDraft({ ...draft, vibe: draft.vibe === v ? null : v })}
                >
                  ✦ {v}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] header-caps text-hl-muted mb-2">Min skill level</div>
              <select
                className={SELECT_CLS}
                value={draft.minSkill}
                onChange={(e) => setDraft({ ...draft, minSkill: e.target.value })}
              >
                {SKILL_TIERS.map((t) => (
                  <option key={t.letter} value={t.letter}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[11px] header-caps text-hl-muted mb-2">Max skill level</div>
              <select
                className={SELECT_CLS}
                value={draft.maxSkill}
                onChange={(e) => setDraft({ ...draft, maxSkill: e.target.value })}
              >
                {SKILL_TIERS.map((t) => (
                  <option key={t.letter} value={t.letter}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="text-[11px] header-caps text-hl-muted mb-2">Language</div>
            <select
              className={SELECT_CLS}
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
            >
              <option value="All">All languages</option>
              <option>English</option>
              <option>Portuguese</option>
              <option>Spanish</option>
              <option>German</option>
              <option>French</option>
            </select>
          </div>

          <div>
            <div className="text-[11px] header-caps text-hl-muted mb-2">Country</div>
            <select
              className={SELECT_CLS}
              value={draft.country}
              onChange={(e) => setDraft({ ...draft, country: e.target.value })}
            >
              <option value="All">All countries</option>
              <option>Portugal</option>
              <option>United Kingdom</option>
              <option>Germany</option>
              <option>France</option>
              <option>Spain</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-hl-border">
            <button
              onClick={() => setDraft(DEFAULT_ADV)}
              className="px-4 py-2.5 rounded-lg text-hl-muted font-bold text-sm header-caps hover:text-white transition-colors"
            >
              Reset filters
            </button>
            <button
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
              className="px-6 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm header-caps hover:opacity-90 transition-opacity"
            >
              Apply
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PartyFinderContent() {
  const searchParams = useSearchParams();
  const [parties, setParties] = useState<PartyView[]>([]);
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [joinableOnly, setJoinableOnly] = useState(true);
  const [adv, setAdv] = useState<AdvFilters>(DEFAULT_ADV);
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

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

  const loadFriends = async () => {
    try {
      const res = await fetch("/api/friends");
      if (!res.ok) return;
      const data = await res.json();
      setFriends(
        (data.friends ?? []).map((f: { name: string; avatar: string | null }) => ({
          name: f.name,
          avatar: f.avatar,
        }))
      );
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    loadFriends();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user ?? null))
      .catch(() => { });
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleInvite = async (partyId: string, friendName: string) => {
    try {
      const res = await fetch(`/api/parties/${partyId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toName: friendName }),
      });
      const data = await res.json();
      if (!res.ok) setNotice(data.error || "Failed to invite.");
      else setNotice(data.status === "pending" ? "Invite already pending." : "Invite sent.");
      load(); // refresh so the invite menu shows "Invited"
    } catch {
      setNotice("Failed to invite.");
    }
    setTimeout(() => setNotice(null), 4000);
  };

  // Open the create modal when arriving via the sidebar "Create" link.
  useEffect(() => {
    if (searchParams.get("create") === "1") setCreateOpen(true);
  }, [searchParams]);

  const joinableCount = useMemo(
    () => parties.filter((p) => p.members.length < p.maxSize).length,
    [parties]
  );

  const advActive =
    adv.verified || adv.voice || adv.vibe !== null || adv.minSkill !== "D" ||
    adv.maxSkill !== "STAR" || adv.language !== "All" || adv.country !== "All";

  const filtered = useMemo(() => {
    return parties.filter((p) => {
      if (premiumOnly && p.matchType !== "Premium") return false;
      if (joinableOnly && p.members.length >= p.maxSize) return false;
      if (adv.verified && !p.verifiedOnly) return false;
      if (adv.voice && !p.voiceRequired) return false;
      if (adv.vibe && p.vibe !== adv.vibe) return false;
      // Skill ranges must overlap.
      if (tierIdx(p.maxSkill) < tierIdx(adv.minSkill)) return false;
      if (tierIdx(p.minSkill) > tierIdx(adv.maxSkill)) return false;
      if (adv.language !== "All" && p.language !== adv.language && p.language !== "Any") return false;
      if (adv.country !== "All" && p.countries !== adv.country && p.countries !== "Any") return false;
      return true;
    });
  }, [parties, premiumOnly, joinableOnly, adv]);

  const handleJoin = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/parties/${id}/join`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.party) {
        setParties((prev) => prev.map((p) => (p.id === id ? data.party : p)));
      } else if (!res.ok) {
        // Surface the reason (full, private, expired…) instead of failing silently.
        setNotice(data.error || "Failed to join party.");
        setTimeout(() => setNotice(null), 4000);
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
      // Re-fetch the visibility-filtered list rather than trusting the response.
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-xl font-black text-white mb-5">Party Finder</h1>

      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-hl-gold/10 border border-hl-gold/30 text-hl-gold text-sm">
          {notice}
        </div>
      )}

      {/* Control bar (FACEIT-style) */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <select className="bg-hl-panel border border-hl-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-hl-gold/50">
          <option>Blox Strike</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-white cursor-pointer bg-hl-panel border border-hl-border rounded-lg px-3 py-2">
          <span className="text-hl-gold">★</span> Premium
          <input type="checkbox" checked={premiumOnly} onChange={(e) => setPremiumOnly(e.target.checked)} className="accent-hl-gold" />
        </label>

        {/* Joinable / Open segmented toggle */}
        <div className="inline-flex items-center rounded-lg border border-hl-border overflow-hidden">
          <button
            onClick={() => setJoinableOnly(true)}
            className={`px-3 py-2 text-sm font-bold transition-colors ${
              joinableOnly ? "bg-hl-gold/15 text-hl-gold" : "text-hl-muted hover:text-white"
            }`}
          >
            Joinable
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gold-gradient text-hl-base stat-number">
              {joinableCount}
            </span>
          </button>
          <button
            onClick={() => setJoinableOnly(false)}
            className={`px-3 py-2 text-sm font-bold transition-colors ${
              !joinableOnly ? "bg-hl-gold/15 text-hl-gold" : "text-hl-muted hover:text-white"
            }`}
          >
            Open
          </button>
        </div>

        <button
          onClick={() => setFiltersOpen(true)}
          title="Filters"
          className={`p-2.5 rounded-lg border transition-colors ${
            advActive
              ? "border-hl-gold/50 bg-hl-gold/10 text-hl-gold"
              : "border-hl-border text-hl-muted hover:text-white"
          }`}
        >
          <Filter className="w-4 h-4" />
        </button>

        <button
          onClick={() => setCreateOpen(true)}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-hl-gold font-bold text-sm header-caps hover:bg-hl-gold/10 transition-colors"
        >
          <Plus className="w-4 h-4" /> Create
        </button>
      </div>

      {/* Party list */}
      {loading ? (
        <div className="space-y-6">
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
        <div className="space-y-6">
          {filtered.map((party) => (
            <PartyCard
              key={party.id}
              party={party}
              currentUserId={session?.discordId}
              onJoin={handleJoin}
              onLeave={handleLeave}
              friends={friends}
              onInvite={handleInvite}
              busy={busyId === party.id}
            />
          ))}
        </div>
      )}

      <FiltersModal open={filtersOpen} onOpenChange={setFiltersOpen} value={adv} onApply={setAdv} />

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
