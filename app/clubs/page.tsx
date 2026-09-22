"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { ClubColorPicker, ClubMark } from "@/components/club-identity";
import { Building2, Coins, Lock, Search, Users } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { invalidateClientApi } from "@/lib/client-api";
import { DEFAULT_PROFILE_BACKGROUNDS } from "@/lib/profile-backgrounds";
import { QUEUE_REGIONS, regionMeta } from "@/lib/regions";

interface ClubRow {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
  description: string;
  region: string;
  ownerName: string;
  memberCount: number;
  private?: boolean;
  mine?: boolean;
}

const DEFAULT_ACCENT: string = DEFAULT_PROFILE_BACKGROUNDS[1].color;

export default function ClubsPage() {
  const { session, loaded, coins, refresh } = useSession();
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [createCost, setCreateCost] = useState(2000);
  const [maxOwned, setMaxOwned] = useState(3);
  const [ownedCount, setOwnedCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [isPrivate, setIsPrivate] = useState(false);
  const [region, setRegion] = useState(QUEUE_REGIONS[0].id);
  const [query, setQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/clubs");
      const data = await res.json();
      setClubs(Array.isArray(data.clubs) ? data.clubs : []);
      if (typeof data.createCost === "number") setCreateCost(data.createCost);
      if (typeof data.maxOwned === "number") setMaxOwned(data.maxOwned);
      if (typeof data.ownedCount === "number") setOwnedCount(data.ownedCount);
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
        body: JSON.stringify({
          name,
          tag,
          description,
          region,
          rules,
          accentColor,
          logoUrl,
          private: isPrivate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create club");
        return;
      }
      setName("");
      setTag("");
      setDescription("");
      setRules("");
      setLogoUrl("");
      setAccentColor(DEFAULT_ACCENT);
      setIsPrivate(false);
      setCreating(false);
      invalidateClientApi("/api/auth/me");
      await Promise.all([load(), refresh({ force: true })]);
    } catch {
      setError("Could not create club");
    } finally {
      setBusy(false);
    }
  };

  const { mine, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = clubs.filter((club) => {
      if (regionFilter !== "ALL" && club.region !== regionFilter) return false;
      if (!q) return true;
      return (
        club.name.toLowerCase().includes(q) ||
        (club.tag || "").toLowerCase().includes(q)
      );
    });
    return {
      mine: session ? matched.filter((c) => c.mine) : [],
      rest: session ? matched.filter((c) => !c.mine) : matched,
    };
  }, [clubs, query, regionFilter, session]);

  return (
    <div className="hl-page">
      <PageHeader
        icon={Building2}
        title="Clubs"
        subtitle="Open communities with their own identity, rules, and member board."
      />

      <div className="mb-6">
        {loaded && !session ? (
          <p className="text-sm text-hl-muted">
            <Link href="/login" className="text-hl-gold font-bold hover:underline">
              Log in
            </Link>{" "}
            to create or join a club.
          </p>
        ) : !creating ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={ownedCount >= maxOwned}
              className="find-match-btn h-10 rounded-xl px-5 text-sm font-black header-caps text-hl-base disabled:opacity-50"
            >
              Create Club
            </button>
            <span className="text-xs text-hl-muted flex items-center gap-1">
              <Coins className="w-3.5 h-3.5 text-hl-gold" />
              {createCost.toLocaleString()} HL Coins · {ownedCount}/{maxOwned} owned
            </span>
          </div>
        ) : (
          <Card className="bg-hl-panel border-hl-border p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs header-caps text-hl-muted">Create a club</div>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
                className="text-xs font-bold text-hl-muted hover:text-white"
              >
                Cancel
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_120px_160px]">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 40))}
                  placeholder="Club name"
                  className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
                />
                <input
                  value={tag}
                  onChange={(e) =>
                    setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))
                  }
                  placeholder="TAG"
                  className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50 tracking-widest"
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
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value.slice(0, 500))}
                placeholder="Logo image URL (https, optional)"
                className="w-full h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
              />
              <label className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="accent-hl-gold"
                />
                Private (invite only)
              </label>
              <div>
                <div className="text-[11px] header-caps text-hl-muted mb-2">Banner color</div>
                <ClubColorPicker value={accentColor} onChange={setAccentColor} />
              </div>
              <div className="flex items-center justify-between gap-3">
                {error ? (
                  <p className="text-sm text-hl-red">{error}</p>
                ) : (
                  <span className="text-xs text-hl-muted flex items-center gap-1">
                    <Coins className="w-3.5 h-3.5 text-hl-gold" />
                    Costs {createCost.toLocaleString()} HL Coins
                    {coins < createCost ? ` · you have ${coins.toLocaleString()}` : ""}
                  </span>
                )}
                <button
                  type="button"
                  onClick={create}
                  disabled={
                    busy ||
                    name.trim().length < 3 ||
                    tag.length < 2 ||
                    coins < createCost ||
                    ownedCount >= maxOwned ||
                    !session?.playerName
                  }
                  className="find-match-btn h-10 rounded-xl px-5 text-sm font-black header-caps text-hl-base disabled:opacity-50"
                >
                  {busy ? "Creating…" : `Create · ${createCost.toLocaleString()}`}
                </button>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-hl-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag"
            className="h-10 w-full rounded-lg border border-hl-border bg-hl-panel pl-9 pr-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
        </div>
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="h-10 rounded-lg border border-hl-border bg-hl-panel px-3 text-sm text-white focus:outline-none focus:border-hl-gold/50 sm:w-44"
        >
          <option value="ALL">All regions</option>
          {QUEUE_REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {mine.length === 0 && rest.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={clubs.length === 0 ? "No clubs yet" : "No matching clubs"}
          hint={clubs.length === 0 ? "Be the first to start one." : "Try a different name, tag, or region."}
        />
      ) : (
        <div className="space-y-6">
          {mine.length > 0 ? (
            <section>
              <div className="mb-3 text-[11px] font-bold header-caps text-hl-gold">My clubs</div>
              <div className="grid gap-3 md:grid-cols-2">
                {mine.map((club) => (
                  <ClubCard key={club.id} club={club} />
                ))}
              </div>
            </section>
          ) : null}
          {rest.length > 0 ? (
            <section>
              {mine.length > 0 ? (
                <div className="mb-3 text-[11px] font-bold header-caps text-hl-muted">All clubs</div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {rest.map((club) => (
                  <ClubCard key={club.id} club={club} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ClubCard({ club }: { club: ClubRow }) {
  return (
    <Link
      href={`/clubs/${club.id}`}
      className="block rounded-xl border border-hl-border bg-hl-panel p-4 hover:border-hl-gold/40 transition-colors"
    >
      <div className="flex items-start gap-3">
        <ClubMark
          tag={club.tag}
          accentColor={club.accentColor}
          logoUrl={club.logoUrl}
          size={48}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">{club.name}</h2>
              <div className="text-xs font-bold text-hl-gold tracking-wide">[{club.tag}]</div>
            </div>
            <span className="text-[11px] font-bold header-caps text-hl-muted shrink-0 flex items-center gap-1">
              {club.private ? <Lock className="w-3 h-3" /> : null}
              {regionMeta(club.region).short}
            </span>
          </div>
          <p className="mt-1 text-sm text-hl-muted line-clamp-2">
            {club.description || "No description yet."}
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-hl-muted">
            <Users className="w-3.5 h-3.5" />
            {club.memberCount} {club.memberCount === 1 ? "member" : "members"}
            {club.private ? " · Invite only" : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}
