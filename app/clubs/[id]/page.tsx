"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { RankBadge } from "@/components/rank-badge";
import { ClubColorPicker, ClubMark, ClubTaggedName } from "@/components/club-identity";
import { Crown, Lock, Users } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { profileBackgroundImage } from "@/lib/profile-backgrounds";
import { regionMeta } from "@/lib/regions";
import type { RankTierLetter } from "@/types";

interface ClubRoleDef {
  id: string;
  name: string;
  rank: number;
  canInvite: boolean;
  canKick: boolean;
  canPromote: boolean;
  canEdit: boolean;
  builtin: boolean;
}

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
  private: boolean;
  roles: ClubRoleDef[];
  invites: { token: string; createdAt: number }[];
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
  const [inviteFromUrl, setInviteFromUrl] = useState("");
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
  const [isPrivate, setIsPrivate] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [copied, setCopied] = useState(false);

  const applyPayload = (data: { club?: Club; leaderboard?: BoardRow[] }) => {
    if (!data.club) return;
    setClub(data.club);
    setName(data.club.name ?? "");
    setTag(data.club.tag ?? "");
    setDescription(data.club.description ?? "");
    setRules(data.club.rules ?? "");
    setAccentColor(data.club.accentColor ?? "");
    setLogoUrl(data.club.logoUrl ?? "");
    setIsPrivate(!!data.club.private);
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

  useEffect(() => {
    setInviteFromUrl(new URLSearchParams(window.location.search).get("invite") || "");
  }, []);

  const me = session?.discordId ?? null;
  const myMember = club?.members.find((m) => m.discordId === me);
  const owner = club?.ownerId === me;
  const myRole = club && myMember ? club.roles.find((r) => r.id === myMember.role) : null;
  const canEdit = owner || !!myRole?.canEdit;
  const canKick = owner || !!myRole?.canKick;
  const canPromote = owner || !!myRole?.canPromote;
  const canInvite = owner || !!myRole?.canInvite;
  const member = !!myMember;

  const act = async (path: string, method = "POST", body?: unknown, closeEdit = false) => {
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
        if (closeEdit) setEditing(false);
      } else if (data.ok) {
        router.push("/clubs");
      }
    } catch {
      setError("Failed");
    } finally {
      setBusy(false);
    }
  };

  const roleName = (roleId: string) =>
    club?.roles.find((r) => r.id === roleId)?.name || roleId;

  const assignableRoles = useMemo(() => {
    if (!club) return [];
    const floor = owner ? -1 : myRole?.rank ?? 999;
    return club.roles.filter((r) => r.id !== "owner" && r.rank > floor);
  }, [club, owner, myRole]);

  if (!club) {
    return <div className="hl-page text-sm text-hl-muted">Loading club…</div>;
  }

  const banner = profileBackgroundImage(club.accentColor);
  const inviteToken = club.invites[0]?.token;
  const inviteLink =
    typeof window !== "undefined" && inviteToken
      ? `${window.location.origin}/clubs/${club.id}?invite=${inviteToken}`
      : "";

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
          <div className="-mt-10 md:-mt-12 flex flex-col items-center text-center">
            <ClubMark
              tag={club.tag}
              accentColor={club.accentColor}
              logoUrl={club.logoUrl}
              size={88}
              className="ring-4 ring-hl-panel shadow-lg"
            />
            <div className="mt-3 text-[11px] header-caps text-hl-gold">
              Strike Force · {regionMeta(club.region).label}
              {club.private ? " · Invite only" : ""}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-2">
              <h1 className="text-3xl font-black text-white">{club.name}</h1>
              <span className="text-lg font-black tracking-wide text-hl-gold">[{club.tag}]</span>
            </div>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-hl-muted">
              <Users className="w-4 h-4" />
              {club.members.length} {club.members.length === 1 ? "member" : "members"}
              {club.private ? <Lock className="w-3.5 h-3.5" /> : null}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!member && session ? (
                club.private && !inviteFromUrl ? (
                  <span className="h-9 inline-flex items-center rounded-xl border border-hl-border px-4 text-sm font-bold text-hl-muted">
                    Invite only
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(`/api/clubs/${id}/join`, "POST", { invite: inviteFromUrl })}
                    className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base disabled:opacity-50"
                  >
                    Join club
                  </button>
                )
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
              {canEdit || owner ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing((v) => !v)}
                  className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white hover:border-hl-gold/40"
                >
                  {editing ? "Cancel" : "Edit club"}
                </button>
              ) : null}
              {owner ? (
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
            <p className="mt-4 max-w-3xl text-sm text-hl-muted">
              {club.description || "No description yet."}
            </p>
            {error ? <p className="mt-2 text-sm text-hl-red">{error}</p> : null}
          </div>
        </div>
      </div>

      {editing && (canEdit || owner) ? (
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
          <label className="flex items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="accent-hl-gold"
              disabled={!owner}
            />
            Private (invite only)
          </label>
          <div>
            <div className="text-[11px] header-caps text-hl-muted mb-2">Banner color</div>
            <ClubColorPicker value={accentColor} onChange={setAccentColor} />
          </div>
          {owner ? (
            <div className="space-y-2 border-t border-hl-border pt-3">
              <div className="text-[11px] header-caps text-hl-muted">Roles (Owner & Member are defaults, max 7)</div>
              {club.roles.map((role) => (
                <div key={role.id} className="flex flex-wrap items-center gap-2 text-xs text-hl-muted">
                  <span className="w-28 font-bold text-white">{role.name}</span>
                  {role.builtin ? (
                    <span>Default</span>
                  ) : (
                    <>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={role.canInvite}
                          onChange={(e) =>
                            act(`/api/clubs/${id}/roles`, "PATCH", {
                              roleId: role.id,
                              canInvite: e.target.checked,
                            })
                          }
                        />
                        Invite
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={role.canKick}
                          onChange={(e) =>
                            act(`/api/clubs/${id}/roles`, "PATCH", {
                              roleId: role.id,
                              canKick: e.target.checked,
                            })
                          }
                        />
                        Kick
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={role.canPromote}
                          onChange={(e) =>
                            act(`/api/clubs/${id}/roles`, "PATCH", {
                              roleId: role.id,
                              canPromote: e.target.checked,
                            })
                          }
                        />
                        Promote
                      </label>
                      <button
                        type="button"
                        className="text-hl-red font-bold"
                        onClick={() => act(`/api/clubs/${id}/roles?roleId=${role.id}`, "DELETE")}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
              {club.roles.length < 7 ? (
                <div className="flex gap-2">
                  <input
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value.slice(0, 24))}
                    placeholder="New role name"
                    className="h-9 flex-1 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={busy || newRole.trim().length < 2}
                    onClick={() => {
                      act(`/api/clubs/${id}/roles`, "POST", { name: newRole });
                      setNewRole("");
                    }}
                    className="h-9 rounded-lg border border-hl-border px-3 text-xs font-bold text-white"
                  >
                    Add role
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy || name.trim().length < 3 || tag.length < 2}
            onClick={() =>
              act(
                `/api/clubs/${id}`,
                "PATCH",
                {
                  name,
                  tag,
                  description,
                  rules,
                  accentColor,
                  logoUrl,
                  private: isPrivate,
                },
                true
              )
            }
            className="find-match-btn h-9 rounded-xl px-4 text-sm font-black header-caps text-hl-base disabled:opacity-50"
          >
            Save
          </button>
        </Card>
      ) : null}

      {canInvite ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-6">
          <div className="text-sm font-bold text-white mb-2">Invite link</div>
          {inviteToken ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs text-hl-muted break-all">{inviteLink}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="h-8 rounded-lg border border-hl-border px-3 text-xs font-bold text-white"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(`/api/clubs/${id}/invite`)}
              className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white"
            >
              Create invite
            </button>
          )}
          {inviteToken ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(`/api/clubs/${id}/invite`)}
              className="mt-2 text-xs font-bold text-hl-gold hover:underline"
            >
              New invite
            </button>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card className="bg-hl-panel border-hl-border overflow-hidden p-0">
            <div className="border-b border-hl-border px-4 py-3 text-sm font-bold text-white">
              Members · {club.members.length}
            </div>
            <div className="divide-y divide-hl-border">
              {club.members.map((row) => {
                const label = row.playerName || row.username;
                const targetRole = club.roles.find((r) => r.id === row.role);
                const canManage =
                  (canKick || canPromote) &&
                  row.discordId !== me &&
                  row.role !== "owner" &&
                  (owner || (targetRole && myRole && targetRole.rank > myRole.rank));
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
                          <ClubTaggedName name={label} tag={club.tag} />
                        </Link>
                      ) : (
                        <div className="truncate text-sm font-semibold text-white">
                          <ClubTaggedName name={label} tag={club.tag} />
                        </div>
                      )}
                      <div className="text-xs text-hl-muted">{roleName(row.role)}</div>
                    </div>
                    {row.role === "owner" ? <Crown className="w-4 h-4 text-hl-gold shrink-0" /> : null}
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        {canPromote ? (
                          <select
                            value={row.role}
                            disabled={busy}
                            onChange={(e) =>
                              act(`/api/clubs/${id}/roles`, "POST", {
                                discordId: row.discordId,
                                roleId: e.target.value,
                              })
                            }
                            className="h-8 rounded-md border border-hl-border bg-hl-base px-2 text-xs text-white"
                          >
                            {assignableRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {canKick ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(`/api/clubs/${id}/kick`, "POST", { discordId: row.discordId })}
                            className="text-xs font-bold text-hl-red"
                          >
                            Kick
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="bg-hl-panel border-hl-border overflow-hidden p-0">
            <div className="border-b border-hl-border px-4 py-3 text-sm font-bold text-white">
              Leaderboard
            </div>
            <div className="divide-y divide-hl-border">
              {board.map((row, idx) => {
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
                          <ClubTaggedName name={label} tag={club.tag} />
                        </Link>
                      ) : (
                        <div className="truncate text-sm font-semibold text-white">
                          <ClubTaggedName name={label} tag={club.tag} />
                        </div>
                      )}
                    </div>
                    <RankBadge rank={row.rank} size="sm" showGlow={false} />
                    <div className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-white">
                      {row.placementDone ? row.elo : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
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
