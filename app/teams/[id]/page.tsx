"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ClubColorPicker, ClubMark } from "@/components/club-identity";
import { useSession } from "@/components/session-provider";
import { QUEUE_REGIONS, regionMeta } from "@/lib/regions";

interface Member {
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  role: "captain" | "starter" | "sub";
  status: "invited" | "accepted";
}

interface Team {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
  region: string;
  captainId: string;
  captainName: string;
  members: Member[];
}

interface TitleRow {
  id: number;
  title: string;
  awardedBy: string | null;
  awardedAt: number;
}

export default function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { session } = useSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [accentColor, setAccentColor] = useState("#ff5500");
  const [region, setRegion] = useState("EU");

  const load = useCallback(async () => {
    const res = await fetch(`/api/teams/${id}`);
    const data = await res.json();
    if (!data.team) {
      setTeam(null);
      return;
    }
    setTeam(data.team);
    setTitles(Array.isArray(data.titles) ? data.titles : []);
    setName(data.team.name);
    setTag(data.team.tag);
    setLogoUrl(data.team.logoUrl || "");
    setAccentColor(data.team.accentColor);
    setRegion(data.team.region);
  }, [id]);

  useEffect(() => {
    load().catch(() => setTeam(null));
  }, [load]);

  const act = async (body: Record<string, unknown>, method = "POST") => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${id}`, {
        method,
        headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      if (method === "DELETE" || data.ok && body.action === "leave" && !data.team) {
        router.push("/teams");
        return;
      }
      if (data.team) setTeam(data.team);
      else await load();
    } catch {
      setError("Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!team) {
    return <div className="hl-page text-sm text-hl-muted">Loading team…</div>;
  }

  const me = session?.discordId ?? null;
  const captain = team.captainId === me;
  const myRow = team.members.find((m) => m.discordId === me);
  const pending = myRow?.status === "invited";

  return (
    <div className="hl-page">
      <Link href="/teams" className="text-xs font-bold text-hl-gold hover:underline">
        ← All teams
      </Link>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <ClubMark
          tag={team.tag}
          accentColor={team.accentColor}
          logoUrl={team.logoUrl}
          size={72}
          className="!rounded-full"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black text-white">
            {team.name} <span className="text-hl-gold">[{team.tag}]</span>
          </h1>
          <p className="mt-1 text-sm text-hl-muted">
            Captained by {team.captainName} · {regionMeta(team.region).label} ·{" "}
            {team.members.filter((m) => m.status === "accepted").length} members
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pending ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act({ action: "respond", accept: true })}
                  className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base"
                >
                  Accept invite
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act({ action: "respond", accept: false })}
                  className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white"
                >
                  Decline
                </button>
              </>
            ) : null}
            {captain ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white"
                >
                  {editing ? "Cancel" : "Edit"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Delete this team?")) act({}, "DELETE");
                  }}
                  className="h-9 rounded-xl border border-hl-red/40 px-4 text-sm font-bold text-hl-red"
                >
                  Delete
                </button>
              </>
            ) : myRow?.status === "accepted" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => act({ action: "leave" })}
                className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white"
              >
                Leave team
              </button>
            ) : null}
            <Link
              href="/tournaments"
              className="h-9 inline-flex items-center rounded-xl border border-hl-border px-4 text-sm font-bold text-white hover:border-hl-gold/40"
            >
              Find tournaments
            </Link>
          </div>
          {error ? <p className="mt-2 text-sm text-hl-red">{error}</p> : null}
        </div>
        <div
          className="shrink-0 rounded-xl border border-hl-gold/30 bg-hl-panel px-5 py-3 text-center"
          title="Titles awarded by Match Staff"
        >
          <div className="flex items-center justify-center gap-1.5 text-hl-gold">
            <Trophy className="h-4 w-4" />
            <span className="text-2xl font-black tabular-nums">{titles.length}</span>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-hl-muted">
            {titles.length === 1 ? "Title" : "Titles"}
          </div>
        </div>
      </div>

      <Card className="mt-6 border-hl-border bg-hl-panel p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
          <Trophy className="h-4 w-4 text-hl-gold" /> Titles
        </div>
        {titles.length === 0 ? (
          <p className="text-xs text-hl-muted">
            No titles yet. Match Staff award titles for tournament wins.
          </p>
        ) : (
          <ul className="divide-y divide-hl-border">
            {titles.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm font-semibold text-white">{t.title}</span>
                <span className="shrink-0 text-xs text-hl-muted">
                  {new Date(t.awardedAt).toLocaleDateString([], {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && captain ? (
        <Card className="mt-6 space-y-3 border-hl-border bg-hl-panel p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_120px]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
            />
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
              className="h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm tracking-widest text-white"
            />
          </div>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="h-10 w-full rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
          >
            {QUEUE_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value.slice(0, 500))}
            placeholder="Logo URL"
            className="h-10 w-full rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
          />
          <ClubColorPicker value={accentColor} onChange={setAccentColor} />
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await fetch(`/api/teams/${id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name, tag, region, logoUrl: logoUrl || null, accentColor }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setError(data.error || "Failed");
                  return;
                }
                setTeam(data.team);
                setEditing(false);
              } catch {
                setError("Failed");
              } finally {
                setBusy(false);
              }
            }}
            className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base"
          >
            Save
          </button>
        </Card>
      ) : null}

      {captain ? (
        <Card className="mt-6 border-hl-border bg-hl-panel p-4">
          <div className="mb-2 text-sm font-bold text-white">Invite player</div>
          <div className="flex flex-wrap gap-2">
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Player name"
              className="h-10 min-w-[180px] flex-1 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
            />
            <button
              type="button"
              disabled={busy || inviteName.trim().length < 2}
              onClick={() => {
                act({ action: "invite", playerName: inviteName.trim() });
                setInviteName("");
              }}
              className="h-10 rounded-xl border border-hl-border px-4 text-sm font-bold text-white"
            >
              Invite
            </button>
          </div>
        </Card>
      ) : null}

      <Card className="mt-6 overflow-hidden border-hl-border bg-hl-panel p-0">
        <div className="border-b border-hl-border px-4 py-3 text-sm font-bold text-white">Roster</div>
        <div className="divide-y divide-hl-border">
          {team.members.map((m) => {
            const label = m.playerName || m.username;
            return (
              <div key={m.discordId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar className="h-8 w-8 border border-hl-border">
                  {m.avatar ? <AvatarImage src={m.avatar} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-[10px] font-bold text-hl-gold">
                    {label.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  {m.playerName ? (
                    <Link
                      href={`/profile?player=${encodeURIComponent(m.playerName)}`}
                      className="block truncate text-sm font-semibold text-white hover:text-hl-gold"
                    >
                      {label}
                    </Link>
                  ) : (
                    <div className="truncate text-sm font-semibold text-white">{label}</div>
                  )}
                  <div className="text-xs text-hl-muted capitalize">
                    {m.role}
                    {m.status === "invited" ? " · invited" : ""}
                  </div>
                </div>
                {captain && m.discordId !== me && m.status === "accepted" ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role === "captain" ? "starter" : m.role}
                      disabled={busy || m.role === "captain"}
                      onChange={(e) =>
                        act({ action: "slot", discordId: m.discordId, role: e.target.value })
                      }
                      className="h-8 rounded-md border border-hl-border bg-hl-base px-2 text-xs text-white"
                    >
                      <option value="starter">Starter</option>
                      <option value="sub">Sub</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Make ${label} the captain?`)) {
                          act({ action: "transfer", discordId: m.discordId });
                        }
                      }}
                      className="text-xs font-bold text-hl-gold hover:underline"
                    >
                      Make captain
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act({ action: "kick", discordId: m.discordId })}
                      className="text-xs font-bold text-hl-red"
                    >
                      Kick
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
