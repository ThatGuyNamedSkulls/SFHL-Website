"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAPS } from "@/data/maps";
import { QUEUE_REGIONS } from "@/lib/regions";

const field =
  "h-10 w-full rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white focus:outline-none focus:border-hl-gold/50";

export function TournamentCreateForm({
  kind,
  clubId,
  onCreated,
  onCancel,
}: {
  kind: "official" | "community";
  clubId?: string;
  onCreated?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [region, setRegion] = useState(QUEUE_REGIONS[0].id);
  const [bracket, setBracket] = useState<"single" | "double">("single");
  const [size, setSize] = useState<8 | 16>(8);
  const [bo, setBo] = useState<1 | 3>(1);
  const [entryFee, setEntryFee] = useState("0");
  const [split, setSplit] = useState<[string, string, string]>(["60", "30", "10"]);
  const [maps, setMaps] = useState<string[]>(MAPS.map((m) => m.name));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleMap = (map: string) => {
    setMaps((cur) => (cur.includes(map) ? cur.filter((m) => m !== map) : [...cur, map]));
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          kind,
          clubId: clubId ?? null,
          region,
          bracket,
          size,
          bo,
          entryFee: Number(entryFee) || 0,
          potSplit: split.map((n) => Number(n)),
          mapPool: maps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not create the cup");
        return;
      }
      const id = data.tournament?.id as string | undefined;
      if (id && onCreated) onCreated(id);
      else if (id) router.push(`/tournaments/${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 40))}
        placeholder="Cup name"
        className={field}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select value={region} onChange={(e) => setRegion(e.target.value as typeof region)} className={field}>
          {QUEUE_REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select value={size} onChange={(e) => setSize(Number(e.target.value) as 8 | 16)} className={field}>
          <option value={8}>8 teams</option>
          <option value={16}>16 teams</option>
        </select>
        <select value={bracket} onChange={(e) => setBracket(e.target.value as "single" | "double")} className={field}>
          <option value="single">Single elimination</option>
          <option value="double">Double elimination</option>
        </select>
        <select value={bo} onChange={(e) => setBo(Number(e.target.value) as 1 | 3)} className={field}>
          <option value={1}>BO1</option>
          <option value={3}>BO3</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-hl-muted">
          Entry fee
          <input
            value={entryFee}
            onChange={(e) => setEntryFee(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            className={`${field} mt-1`}
          />
        </label>
        {(["1st", "2nd", "3rd"] as const).map((label, i) => (
          <label key={label} className="text-xs text-hl-muted">
            {label} %
            <input
              value={split[i]}
              onChange={(e) => {
                const next = [...split] as [string, string, string];
                next[i] = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
                setSplit(next);
              }}
              className={`${field} mt-1`}
            />
          </label>
        ))}
      </div>
      <div>
        <div className="text-[11px] header-caps text-hl-muted mb-2">Map pool</div>
        <div className="flex flex-wrap gap-2">
          {MAPS.map((map) => {
            const on = maps.includes(map.name);
            return (
              <button
                key={map.id}
                type="button"
                onClick={() => toggleMap(map.name)}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  on ? "border-hl-gold/60 bg-hl-gold/15 text-hl-gold" : "border-hl-border text-hl-muted"
                }`}
              >
                {map.name}
              </button>
            );
          })}
        </div>
      </div>
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      <div className="flex gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-10 rounded-lg border border-hl-border text-sm font-bold text-white"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || name.trim().length < 3}
          onClick={() => void submit()}
          className="flex-1 h-10 rounded-lg bg-gold-gradient text-sm font-black text-hl-base disabled:opacity-40"
        >
          {busy ? "Creating…" : kind === "community" ? "Create clan cup" : "Create cup"}
        </button>
      </div>
    </div>
  );
}
