"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { RankBadge } from "@/components/rank-badge";
import { ClubColorPicker, ClubMark } from "@/components/club-identity";
import { Crown, Users } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { profileBackgroundImage } from "@/lib/profile-backgrounds";
import { regionMeta } from "@/lib/regions";
import type { RankTierLetter } from "@/types";

interface Club {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
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

interface BoardRow {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: string;
  elo: number;
  rank: RankTierLetter;
  placementDone: boolean;
}

export default function ClubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { session } = useSession();
  const [club, setClub] = useState<Club | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  const applyPayload = (data: { club?: Club; leaderboard?: BoardRow[] }) => {
    if (!data.club) return;
    setClub(data.club);
    setName(data.club.name ?? "");
    setTag(data.club.tag ?? "");
    setDescription(data.club.description ?? "");
    setRules(data.club.rules ?? "");
    setAccentColor(data.club.accentColor ?? "");
    setLogoUrl(data.club.logoUrl ?? "");
    if (Array.isArray(data.leaderboard)) setBoard(data.leaderboard);
  };

  const load = useCallback(async () => {
    const res = await fetch(`/api/clubs/${id}`);
    const data = await res.json();
    applyPayload(data);
    if (!data.club) setClub(null);
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
        applyPayload(data);
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

  const banner = profileBackgroundImage(club.accentColor);
  const rows = board.length > 0 ? board : club.members.map((row) => ({
    discordId: row.discordId,
    username: row.username,
    playerName: row.playerName,
    avatar: row.avatar,
    role: row.role,
    elo: 0,
    rank: "UNRANKED" as RankTierLetter,
    placementDone: false,
  }));

  return (
    <div className="hl-page">
      <Link href="/clubs" className="text-xs font-bold text-hl-gold hover:underline">
        ← All clubs
      </Link>

      <div className="mt-3 mb-6 overflow-hidden rounded-2xl border border-hl-border bg-hl-panel">
        <div
          className="h-36 md:h-44"
          style={banner ? { backgroundImage: banner } : { backgroundColor: club.accentColor }}
        />
        <div className="px-4 md:px-6 pb-5">
          <div className="-mt-10 md:-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end">
            <ClubMark
              tag={club.tag}
              accentColor={club.accentColor}
              logoUrl={club.logoUrl}
              size={88}
              className="ring-4 ring-hl-panel shadow-lg"
            />
            <div className="min-w-0 flex-1 sm:pb-1">
              <div className="text-[11px] header-caps text-hl-gold">
                Strike Force · {regionMeta(club.region).label}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                <h1 className="text-3xl font-black text-white">{club.name}</h1>
                <span className="text-lg font-black tracking-wide text-hl-gold">[{club.tag}]</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-hl-muted">
                <Users className="w-4 h-4" />
                {club.members.length} {club.members.length === 1 ? "member" : "members"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:pb-1">
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
                <Link
                  href="/login"
                  className="h-9 inline-flex items-center rounded-xl border border-hl-border px-4 text-sm font-bold text-white"
                >
                  Log in to join
                </Link>
              ) : null}
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-hl-muted">
            {club.description || "No description yet."}
          </p>
          {error ? <p className="mt-2 text-sm text-hl-red">{error}</p> : null}
        </div>
      </div>

      {owner && editing ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-6 space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_120px]">
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
            rows={5}
            placeholder="Club rules"
            className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value.slice(0, 500))}
            placeholder="Logo image URL (https, optional)"
            className="w-full h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
          />
          <div>
            <div className="text-[11px] header-caps text-hl-muted mb-2">Banner color</div>
            <ClubColorPicker value={accentColor} onChange={setAccentColor} />
          </div>
          <button
            type="button"
            disabled={busy || name.trim().length < 3 || tag.length < 2}
            onClick={() =>
              act(`/api/clubs/${id}`, "PATCH", {
                name,
                tag,
                description,
                rules,
                accentColor,
                logoUrl,
              })
            }
            className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base disabled:opacity-50"
          >
            Save
          </button>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="bg-hl-panel border-hl-border overflow-hidden p-0">
          <div className="border-b border-hl-border px-4 py-3 text-sm font-bold text-white">
            Members · {rows.length}
          </div>
          <div className="divide-y divide-hl-border">
            {rows.map((row, idx) => {
              const label = row.playerName || row.username;
              return (
                <div key={row.discordId} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-6 shrink-0 text-center text-xs font-bold text-hl-muted">
                    {idx + 1}
                  </span>
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
                  <RankBadge rank={row.rank} size="sm" showGlow={false} />
                  <div className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-white">
                    {row.placementDone ? row.elo : "—"}
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
