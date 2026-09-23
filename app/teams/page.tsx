"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { ClubColorPicker, ClubMark } from "@/components/club-identity";
import { useSession } from "@/components/session-provider";
import { QUEUE_REGIONS } from "@/lib/regions";
import { Shield, Users } from "lucide-react";

interface TeamRow {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
  region: string;
  captainName: string;
  memberCount: number;
  maxMembers: number;
  mine: boolean;
  pendingInvite: boolean;
}

export default function TeamsPage() {
  const router = useRouter();
  const { session } = useSession();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [ownedCount, setOwnedCount] = useState(0);
  const [maxOwned, setMaxOwned] = useState(3);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [region, setRegion] = useState("EU");
  const [logoUrl, setLogoUrl] = useState("");
  const [accentColor, setAccentColor] = useState("#ff5500");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"mine" | "all">("mine");

  const load = useCallback(async () => {
    const res = await fetch("/api/teams");
    const data = await res.json().catch(() => ({}));
    setTeams(Array.isArray(data.teams) ? data.teams : []);
    setOwnedCount(Number(data.ownedCount ?? 0));
    setMaxOwned(Number(data.maxOwned ?? 3));
  }, []);

  useEffect(() => {
    load().catch(() => setTeams([]));
  }, [load]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("create") === "1") {
      setCreating(true);
    }
  }, []);

  const visible = useMemo(() => {
    if (filter === "mine") return teams.filter((t) => t.mine || t.pendingInvite);
    return teams;
  }, [teams, filter]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tag, region, logoUrl: logoUrl || null, accentColor }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create team.");
        return;
      }
      setCreating(false);
      setName("");
      setTag("");
      setLogoUrl("");
      if (data.team?.id) router.push(`/teams/${data.team.id}`);
      else await load();
    } catch {
      setError("Could not create team.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hl-page">
      <PageHeader
        icon={Shield}
        title="Teams"
        subtitle="Build a roster and enter club tournaments together."
        actions={
          session ? (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base"
            >
              {creating ? "Close" : "+ Create team"}
            </button>
          ) : (
            <Link href="/login" className="text-sm font-bold text-hl-gold hover:underline">
              Log in to create a team
            </Link>
          )
        }
      />

      {creating && session ? (
        <Card className="mb-6 space-y-3 border-hl-border bg-hl-panel p-4">
          <div className="text-sm font-bold text-white">
            New team · {ownedCount}/{maxOwned} captained
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_120px]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder="Team name"
              className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
            />
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
              placeholder="TAG"
              className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm tracking-widest text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
            >
              {QUEUE_REGIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value.slice(0, 500))}
              placeholder="Logo URL (optional)"
              className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted"
            />
          </div>
          <div>
            <div className="mb-2 text-[11px] header-caps text-hl-muted">Accent</div>
            <ClubColorPicker value={accentColor} onChange={setAccentColor} />
          </div>
          {error ? <p className="text-sm text-hl-red">{error}</p> : null}
          <button
            type="button"
            disabled={busy || name.trim().length < 2 || tag.length < 2}
            onClick={create}
            className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create team"}
          </button>
        </Card>
      ) : null}

      <div className="mb-4 flex gap-2">
        {(["mine", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-bold border ${
              filter === key
                ? "border-transparent bg-gold-gradient text-hl-base"
                : "border-hl-border text-hl-muted hover:text-white"
            }`}
          >
            {key === "mine" ? "My teams" : "All teams"}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="py-16 text-center text-sm text-hl-muted">
          {filter === "mine" ? "You are not on a team yet." : "No teams created yet."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((team) => (
            <Link
              key={team.id}
              href={`/teams/${team.id}`}
              className="rounded-xl border border-hl-border bg-hl-panel p-4 hover:border-hl-gold/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ClubMark
                  tag={team.tag}
                  accentColor={team.accentColor}
                  logoUrl={team.logoUrl}
                  size={44}
                  className="!rounded-full"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-white">{team.name}</div>
                  <div className="text-xs text-hl-muted">
                    [{team.tag}] · Captained by {team.captainName}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-hl-muted">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {team.memberCount}/{team.maxMembers}
                </span>
                {team.pendingInvite ? (
                  <span className="font-bold text-hl-gold">Invite pending</span>
                ) : team.mine ? (
                  <span className="font-bold text-[#7dff4f]">Joined</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
