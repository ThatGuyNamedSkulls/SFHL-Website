"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { TournamentCreateForm } from "@/components/tournament-create-form";
import { regionMeta } from "@/lib/regions";
import { Coins, Filter, Plus, Trophy, X } from "lucide-react";

interface CupCard {
  id: string;
  name: string;
  kind: "official" | "community";
  clubId: string | null;
  region: string;
  bracket: "single" | "double";
  size: number;
  bo: number;
  entryFee: number;
  pot: number;
  status: "open" | "live" | "completed" | "cancelled";
  teamCount: number;
  createdAt: number;
  organizer: string;
  mine: boolean;
}

type Tab = "browse" | "mine";
type StatusFilter = "all" | "open" | "live" | "completed";
type KindFilter = "all" | "official" | "community";
type BracketFilter = "all" | "single" | "double";

const PAGE_SIZE = 20;

function statusLabel(status: CupCard["status"]) {
  if (status === "live") return "Live";
  if (status === "open") return "Open";
  return "Finished";
}

function statusTone(status: CupCard["status"]) {
  if (status === "live") return "text-[#ff4d4d]";
  if (status === "open") return "text-[#7dff4f]";
  return "text-[#8a8a8a]";
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function FeaturedCard({ cup }: { cup: CupCard }) {
  const tones = [
    "radial-gradient(circle at 75% 35%, rgba(125,255,79,0.28), transparent 50%), linear-gradient(135deg, #152018, #0f0f0f)",
    "radial-gradient(circle at 75% 35%, rgba(255,85,0,0.35), transparent 50%), linear-gradient(135deg, #241610, #0f0f0f)",
    "radial-gradient(circle at 75% 35%, rgba(90,160,255,0.3), transparent 50%), linear-gradient(135deg, #121826, #0f0f0f)",
  ];
  const tone = tones[cup.id.charCodeAt(0) % tones.length];
  return (
    <Link
      href={`/tournaments/${cup.id}`}
      className="relative min-h-[168px] overflow-hidden rounded-xl border border-white/10 p-4 transition-colors hover:border-white/25"
      style={{ backgroundImage: tone }}
    >
      <div className="relative z-10 flex h-full flex-col justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/70">
            {cup.kind === "official" ? "Official" : "Clan cup"} · {statusLabel(cup.status)}
          </div>
          <h3 className="mt-2 line-clamp-2 text-lg font-black leading-tight text-white">{cup.name}</h3>
          <p className="mt-1 text-xs text-white/60">Organized by {cup.organizer}</p>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1 text-sm font-black text-hl-gold">
              <Coins className="h-3.5 w-3.5" />
              {cup.pot.toLocaleString()}
            </div>
            <div className="text-[10px] text-white/50">Prize pool</div>
          </div>
          <div className="text-right text-xs text-white/70">
            <div>5v5 · BO{cup.bo}</div>
            <div className="font-bold text-white">
              {cup.teamCount}/{cup.size}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CupRow({ cup }: { cup: CupCard }) {
  return (
    <Link
      href={`/tournaments/${cup.id}`}
      className="grid grid-cols-1 items-center gap-2 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.04] md:grid-cols-[140px_minmax(0,1.4fr)_110px_110px_100px_70px]"
    >
      <div className={`text-[11px] font-bold uppercase tracking-wide ${statusTone(cup.status)}`}>
        {statusLabel(cup.status)}
        <div className="mt-0.5 font-semibold normal-case tracking-normal text-[#8a8a8a]">
          {regionMeta(cup.region).short}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate font-bold text-white">{cup.name}</div>
        <div className="truncate text-xs text-[#8a8a8a]">Organized by {cup.organizer}</div>
      </div>
      <div className="text-sm text-[#c8c8c8]">
        5v5
        <div className="text-xs text-[#8a8a8a]">
          {cup.bracket === "double" ? "Double elim" : "Single elim"}
        </div>
      </div>
      <div className="inline-flex items-center gap-1 text-sm font-bold text-hl-gold">
        <Coins className="h-3.5 w-3.5" />
        {cup.pot.toLocaleString()}
      </div>
      <div className="text-sm text-[#c8c8c8]">
        Any
        <div className="text-xs text-[#8a8a8a]">Skill level</div>
      </div>
      <div className="text-right text-sm font-bold tabular-nums text-white">
        {cup.teamCount}/{cup.size}
      </div>
    </Link>
  );
}

export default function TournamentsPage() {
  const [cups, setCups] = useState<CupCard[]>([]);
  const [staff, setStaff] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("browse");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [bracket, setBracket] = useState<BracketFilter>("all");
  const [joinableOnly, setJoinableOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await fetch("/api/tournaments");
    const data = await res.json().catch(() => ({}));
    setCups(Array.isArray(data.tournaments) ? data.tournaments : []);
    setStaff(!!data.staff);
  }, []);

  useEffect(() => {
    load().catch(() => setCups([]));
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [tab, status, kind, bracket, joinableOnly]);

  const filtered = useMemo(() => {
    return cups
      .filter((cup) => {
        if (cup.status === "cancelled") return false;
        if (tab === "mine" && !cup.mine) return false;
        if (status !== "all" && cup.status !== status) return false;
        if (kind !== "all" && cup.kind !== kind) return false;
        if (bracket !== "all" && cup.bracket !== bracket) return false;
        if (joinableOnly && cup.status !== "open") return false;
        return true;
      })
      .sort((a, b) => {
        const rank = (s: CupCard["status"]) => (s === "live" ? 0 : s === "open" ? 1 : 2);
        const dr = rank(a.status) - rank(b.status);
        if (dr !== 0) return dr;
        return b.createdAt - a.createdAt;
      });
  }, [cups, tab, status, kind, bracket, joinableOnly]);

  const featured = useMemo(() => {
    return cups
      .filter((c) => c.status === "open" || c.status === "live")
      .sort((a, b) => b.pot - a.pot || b.teamCount - a.teamCount)
      .slice(0, 3);
  }, [cups]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; rows: CupCard[] }>();
    for (const cup of pageRows) {
      const key = dayKey(cup.createdAt || Date.now());
      const hit = map.get(key);
      if (hit) hit.rows.push(cup);
      else map.set(key, { label: dayLabel(cup.createdAt || Date.now()), rows: [cup] });
    }
    return [...map.values()];
  }, [pageRows]);

  const quickFilters: { id: StatusFilter | "joinable"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "joinable", label: "Joinable only" },
    { id: "open", label: "Upcoming" },
    { id: "live", label: "Ongoing" },
    { id: "completed", label: "Finished" },
  ];

  return (
    <div className="hl-page-wide">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-white">Tournaments</h1>
          <p className="mt-1 text-sm text-[#a0a0a0]">Discover tournaments on HyperLeague.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/teams"
            className="h-9 inline-flex items-center rounded-lg border border-white/10 px-3 text-xs font-bold text-white hover:border-white/30"
          >
            My teams
          </Link>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#ff5500] px-3 text-xs font-black uppercase tracking-wide text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? "Close" : "Create"}
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-5 border-b border-white/10">
        {(
          [
            ["browse", "Browse"],
            ["mine", "My tournaments"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`pb-2 text-xs font-bold uppercase tracking-wide ${
              tab === id
                ? "border-b-2 border-[#ff5500] text-white"
                : "text-[#8a8a8a] hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {creating ? (
        <Card className="mb-6 border-hl-border bg-hl-panel p-4">
          {staff ? (
            <TournamentCreateForm
              kind="official"
              onCancel={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                window.location.href = `/tournaments/${id}`;
              }}
            />
          ) : (
            <div className="space-y-2 text-sm text-hl-muted">
              <p className="font-bold text-white">Create a cup</p>
              <p>
                Official cups are opened by Match Staff. Club owners can create club cups from their{" "}
                <Link href="/clans" className="font-bold text-hl-gold hover:underline">
                  clan page
                </Link>
                .
              </p>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-xs font-bold text-hl-gold hover:underline"
              >
                Close
              </button>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "browse" && featured.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">Featured</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {featured.map((cup) => (
              <FeaturedCard key={cup.id} cup={cup} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {quickFilters.map((f) => {
          const active =
            f.id === "joinable"
              ? joinableOnly
              : !joinableOnly && status === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                if (f.id === "joinable") {
                  setJoinableOnly(true);
                  setStatus("all");
                  return;
                }
                setJoinableOnly(false);
                setStatus(f.id);
              }}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${
                active
                  ? "border-white bg-white text-black"
                  : "border-white/10 text-[#a0a0a0] hover:text-white"
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold ${
            filtersOpen || kind !== "all" || bracket !== "all"
              ? "border-[#ff5500]/50 text-[#ff5500]"
              : "border-white/10 text-[#a0a0a0] hover:text-white"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
        </button>
      </div>

      {filtersOpen ? (
        <div className="mb-5 rounded-xl border border-white/10 bg-[#151515] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Filters</h3>
            <button type="button" onClick={() => setFiltersOpen(false)} className="text-[#8a8a8a] hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">Type</div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", "All"],
                    ["official", "Official"],
                    ["community", "Clan"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                      kind === id ? "border-white bg-white text-black" : "border-white/10 text-[#a0a0a0]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">Bracket</div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", "All"],
                    ["single", "Single elimination"],
                    ["double", "Double elimination"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBracket(id)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                      bracket === id ? "border-white bg-white text-black" : "border-white/10 text-[#a0a0a0]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setKind("all");
              setBracket("all");
              setStatus("all");
              setJoinableOnly(false);
            }}
            className="mt-4 text-xs font-bold text-hl-gold hover:underline"
          >
            Reset filters
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Trophy className="mx-auto mb-3 h-8 w-8 text-[#3a3a3a]" />
          <div className="font-bold text-white">
            {tab === "mine" ? "You are not in any tournaments yet" : "No tournaments match these filters"}
          </div>
          <p className="mt-1 text-sm text-[#8a8a8a]">
            {tab === "mine"
              ? "Join an open cup or create a team and request a slot."
              : "When Match Staff or a clan owner opens one, it shows up here."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.label}>
              <h2 className="mb-1 px-3 text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">
                {group.label}
              </h2>
              <div className="divide-y divide-white/[0.04] rounded-xl border border-white/[0.06] bg-[#121212]">
                {group.rows.map((cup) => (
                  <CupRow key={cup.id} cup={cup} />
                ))}
              </div>
            </section>
          ))}

          {pageCount > 1 ? (
            <div className="flex items-center justify-center gap-1 pt-2">
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === pageCount || Math.abs(n - page) <= 2)
                .reduce<(number | "…")[]>((acc, n, idx, arr) => {
                  if (idx > 0 && n !== (arr[idx - 1] as number) + 1) acc.push("…");
                  acc.push(n);
                  return acc;
                }, [])
                .map((n, i) =>
                  n === "…" ? (
                    <span key={`e${i}`} className="px-2 text-xs text-[#8a8a8a]">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      className={`h-8 min-w-8 rounded-md px-2 text-xs font-bold ${
                        n === page ? "bg-white text-black" : "text-[#a0a0a0] hover:text-white"
                      }`}
                    >
                      {n}
                    </button>
                  )
                )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
