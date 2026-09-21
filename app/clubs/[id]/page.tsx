"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Crown } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { regionMeta } from "@/lib/regions";

interface Club {
  id: string;
  name: string;
  description: string;
  region: string;
  ownerId: string;
  ownerName: string;
  rules: string;
  members: {
    discordId: string;
    username: string;
    playerName: string | null;
    avatar: string | null;
    role: string;
  }[];
}

export default function ClubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { session } = useSession();
  const [club, setClub] = useState<Club | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/clubs/${id}`);
    const data = await res.json();
    setClub(data.club ?? null);
    if (data.club) {
      setDescription(data.club.description ?? "");
      setRules(data.club.rules ?? "");
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => setClub(null));
  }, [load]);

  const me = session?.discordId ?? null;
  const member = !!club?.members.some((m) => m.discordId === me);
  const owner = club?.ownerId === me;

  const act = async (path: string, method = "POST", body?: unknown) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      if (data.club) {
        setClub(data.club);
        setDescription(data.club.description ?? "");
        setRules(data.club.rules ?? "");
        setEditing(false);
      } else if (data.ok) {
        router.push("/clubs");
      }
    } catch {
      setError("Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!club) {
    return <div className="hl-page text-sm text-hl-muted">Loading club…</div>;
  }

  return (
    <div className="hl-page">
      <Link href="/clubs" className="text-xs font-bold text-hl-gold hover:underline">
        ← All clubs
      </Link>
      <header className="mt-3 mb-6">
        <div className="text-[11px] header-caps text-hl-gold">
          Strike Force · {regionMeta(club.region).label}
        </div>
        <h1 className="text-3xl font-black text-white mt-1">{club.name}</h1>
        <p className="mt-2 max-w-2xl text-sm text-hl-muted">
          {club.description || "No description yet."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!member && session ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(`/api/clubs/${id}/join`)}
              className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base disabled:opacity-50"
            >
              Join club
            </button>
          ) : null}
          {member && !owner ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(`/api/clubs/${id}/leave`)}
              className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white hover:border-hl-gold/40 disabled:opacity-50"
            >
              Leave
            </button>
          ) : null}
          {owner ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing((v) => !v)}
                className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white hover:border-hl-gold/40"
              >
                {editing ? "Cancel" : "Edit club"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this club for everyone?")) {
                    act(`/api/clubs/${id}`, "DELETE");
                  }
                }}
                className="h-9 rounded-xl border border-hl-red/40 px-4 text-sm font-bold text-hl-red disabled:opacity-50"
              >
                Delete club
              </button>
            </>
          ) : null}
          {!session ? (
            <Link href="/login" className="h-9 inline-flex items-center rounded-xl border border-hl-border px-4 text-sm font-bold text-white">
              Log in to join
            </Link>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-sm text-hl-red">{error}</p> : null}
      </header>

      {owner && editing ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-6 space-y-3">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 280))}
            placeholder="Short description"
            className="w-full h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value.slice(0, 2000))}
            rows={5}
            placeholder="Club rules"
            className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/api/clubs/${id}`, "PATCH", { description, rules })}
            className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base disabled:opacity-50"
          >
            Save
          </button>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="bg-hl-panel border-hl-border overflow-hidden p-0">
          <div className="border-b border-hl-border px-4 py-3 text-sm font-bold text-white">
            Members · {club.members.length}
          </div>
          <div className="divide-y divide-hl-border">
            {club.members.map((row) => {
              const label = row.playerName || row.username;
              return (
                <div key={row.discordId} className="flex items-center gap-3 px-4 py-3">
                  <Avatar className="h-8 w-8 border border-hl-border">
                    {row.avatar ? <AvatarImage src={row.avatar} alt="" /> : null}
                    <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                      {label.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    {row.playerName ? (
                      <Link
                        href={`/profile?player=${encodeURIComponent(row.playerName)}`}
                        className="truncate text-sm font-semibold text-white hover:text-hl-gold block"
                      >
                        {label}
                      </Link>
                    ) : (
                      <div className="truncate text-sm font-semibold text-white">{label}</div>
                    )}
                    <div className="text-xs capitalize text-hl-muted">{row.role}</div>
                  </div>
                  {row.role === "owner" ? <Crown className="w-4 h-4 text-hl-gold shrink-0" /> : null}
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="bg-hl-panel border-hl-border p-4">
          <h2 className="mb-2 text-sm font-bold text-white">Rules</h2>
          <p className="whitespace-pre-wrap text-sm text-hl-muted">
            {club.rules || "The owner has not published club rules yet."}
          </p>
        </Card>
      </div>
    </div>
  );
}
