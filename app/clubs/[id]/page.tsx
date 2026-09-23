"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { RankBadge } from "@/components/rank-badge";
import { ClubColorPicker, ClubMark, ClubTaggedName } from "@/components/club-identity";
import { ClubTournaments } from "@/components/club-tournaments";
import { Lock, MessageSquare, Users } from "lucide-react";
import { useSession } from "@/components/session-provider";
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
    clubTag?: string | null;
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
  clubTag?: string | null;
}

export default function ClubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { session, refresh } = useSession();
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
  const [activeClubId, setActiveClubId] = useState<string | null>(null);
  const [section, setSection] = useState<"tournaments" | "leaderboard" | "members" | "rules" | "chat">("tournaments");
  const [memberQuery, setMemberQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [memberPage, setMemberPage] = useState(1);

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
    if (!session?.discordId) {
      setActiveClubId(null);
      return;
    }
    fetch("/api/clubs/tag")
      .then((r) => r.json())
      .then((d) => setActiveClubId(typeof d.activeClubId === "string" ? d.activeClubId : null))
      .catch(() => setActiveClubId(null));
  }, [session?.discordId]);

  useEffect(() => {
    setInviteFromUrl(new URLSearchParams(window.location.search).get("invite") || "");
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(`hl-club-seen:${id}`, String(Date.now()));
    } catch {
      /* ignore */
    }
  }, [id]);

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

      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr] items-start">
        <div>
          <div className="mb-4 px-1">
            <h1 className="mb-3 text-xl font-black tracking-[0.12em] text-white">{club.name}</h1>
            <div className="flex items-center gap-2">
              <ClubMark tag={club.tag} accentColor={club.accentColor} logoUrl={club.logoUrl} size={28} className="!rounded-full" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{club.name}</div>
                <div className="truncate text-[11px] text-[#8a8a8a]">Organized by {club.ownerName}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8a8a8a]">
              <Users className="w-3.5 h-3.5" />
              {club.members.length} {club.members.length === 1 ? "member" : "members"}
              {club.private ? <Lock className="w-3 h-3" /> : null}
              <span>· {regionMeta(club.region).label}</span>
            </div>
            <div className="mt-3 flex flex-col items-stretch gap-1.5 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap [&_span]:whitespace-nowrap">
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
              {member ? (
                <button
                  type="button"
                  disabled={busy || activeClubId === id}
                  onClick={async () => {
                    setError(null);
                    setBusy(true);
                    try {
                      const res = await fetch("/api/clubs/tag", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ clubId: id }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(typeof data.error === "string" ? data.error : "Failed");
                        return;
                      }
                      setActiveClubId(id);
                      await refresh({ force: true });
                    } catch {
                      setError("Failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="h-9 rounded-xl border border-hl-border px-4 text-sm font-bold text-white hover:border-hl-gold/40 disabled:opacity-50"
                >
                  {activeClubId === id ? "Using this tag" : "Use this tag"}
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
            {club.description ? (
              <p className="mt-3 text-xs text-[#8a8a8a]">{club.description}</p>
            ) : null}
            {error ? <p className="mt-2 text-xs text-hl-red">{error}</p> : null}
          </div>

          <nav className="space-y-0.5 border-t border-white/10 pt-2">
            {(
              [
                ["tournaments", "Tournaments"],
                ["leaderboard", "Leaderboards"],
                ["members", "Members"],
                ["rules", "Rules"],
                ["chat", "Chat"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold ${
                  section === key ? "bg-white/10 text-white" : "text-[#a0a0a0] hover:bg-white/5 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
            <Link
              href="/teams"
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#a0a0a0] hover:bg-white/5 hover:text-white"
            >
              Teams
            </Link>
            {section === "chat" ? (
              <button
                type="button"
                className="ml-3 flex w-[calc(100%-0.75rem)] items-center rounded-lg bg-white/5 px-3 py-1.5 text-left text-sm text-white"
              >
                General
              </button>
            ) : null}
            <Link
              href="/queue"
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#a0a0a0] hover:bg-white/5 hover:text-white"
            >
              Club queue
            </Link>
          </nav>
        </div>

        <div>
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

          {section === "tournaments" ? (
            <ClubTournaments clubId={club.id} owner={owner} region={club.region} rules={club.rules} />
          ) : null}

          {section === "rules" ? (
            <div className="space-y-6 text-sm">
              <div>
                <div className="mb-3 text-sm font-bold text-white">Join requirements</div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">Game</div>
                <div className="mt-1 font-semibold text-white">Strike Force</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8a8a8a]">Skill level</div>
                <div className="mt-1 font-semibold text-white">Any</div>
              </div>
              <div>
                <div className="text-sm font-bold text-white">Rules</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#a0a0a0]">
                  {club.rules || "The default competition rules apply."}
                </p>
              </div>
            </div>
          ) : null}

          {section === "chat" ? (
            <ClubChat clubId={id} member={member} owner={owner} me={me} />
          ) : null}

          {section === "members" ? (
          <Card className="bg-hl-panel border-hl-border overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-hl-border px-4 py-3">
              <input
                value={memberQuery}
                onChange={(e) => {
                  setMemberQuery(e.target.value);
                  setMemberPage(1);
                }}
                placeholder="Filter by nickname"
                className="h-9 min-w-[160px] flex-1 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted"
              />
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setMemberPage(1);
                }}
                className="h-9 rounded-lg border border-hl-border bg-hl-base px-2 text-sm text-white"
              >
                <option value="all">All roles</option>
                {club.roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <span className="text-xs text-hl-muted">Member count: {club.members.length}</span>
              {canInvite ? (
                <button
                  type="button"
                  onClick={() => act(`/api/clubs/${id}/invite`)}
                  className="h-9 rounded-lg border border-hl-border px-3 text-xs font-bold text-white"
                >
                  Invite friends
                </button>
              ) : null}
            </div>
            <div className="divide-y divide-hl-border">
              {club.members
                .filter((row) => {
                  if (roleFilter !== "all" && row.role !== roleFilter) return false;
                  const label = (row.playerName || row.username).toLowerCase();
                  return label.includes(memberQuery.trim().toLowerCase());
                })
                .slice((memberPage - 1) * 10, memberPage * 10)
                .map((row) => {
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
                          <ClubTaggedName name={label} tag={row.clubTag} />
                        </Link>
                      ) : (
                        <div className="truncate text-sm font-semibold text-white">
                          <ClubTaggedName name={label} tag={row.clubTag} />
                        </div>
                      )}
                      <div className="text-xs text-hl-muted">{roleName(row.role)}</div>
                    </div>
                    {row.role === "owner" ? (
                      <span className="rounded-full border border-hl-gold/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hl-gold">
                        Owner
                      </span>
                    ) : null}
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
                    {owner && row.discordId !== me ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Transfer ownership of this club to ${label}? You will become a member.`
                            )
                          ) {
                            act(`/api/clubs/${id}/transfer`, "POST", { discordId: row.discordId });
                          }
                        }}
                        className="text-xs font-bold text-hl-gold hover:underline"
                      >
                        Make owner
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <MemberPager
              page={memberPage}
              pages={Math.max(1, Math.ceil(
                club.members.filter((row) => {
                  if (roleFilter !== "all" && row.role !== roleFilter) return false;
                  return (row.playerName || row.username).toLowerCase().includes(memberQuery.trim().toLowerCase());
                }).length / 10
              ))}
              onPage={setMemberPage}
            />
          </Card>
          ) : null}

          {section === "leaderboard" ? (
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
                          <ClubTaggedName name={label} tag={row.clubTag} />
                        </Link>
                      ) : (
                        <div className="truncate text-sm font-semibold text-white">
                          <ClubTaggedName name={label} tag={row.clubTag} />
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MemberPager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1 border-t border-hl-border px-3 py-2">
      {Array.from({ length: pages }, (_, i) => i + 1).slice(0, 8).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPage(n)}
          className={`h-8 min-w-8 rounded-md px-2 text-xs font-bold ${
            n === page ? "bg-white text-black" : "text-[#a0a0a0] hover:text-white"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

interface ChatRow {
  id: number;
  discordId: string;
  username: string;
  playerName: string | null;
  avatar: string | null;
  message: string;
  createdAt: number;
}

function ClubChat({
  clubId,
  member,
  owner,
  me,
}: {
  clubId: string;
  member: boolean;
  owner: boolean;
  me: string | null;
}) {
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!member) return;
    try {
      const res = await fetch(`/api/clubs/${clubId}/chat`);
      const data = await res.json();
      if (res.ok) setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      /* ignore */
    }
  }, [clubId, member]);

  useEffect(() => {
    load();
    if (!member) return;
    const id = window.setInterval(load, 4000);
    return () => window.clearInterval(id);
  }, [load, member]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${clubId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send");
        return;
      }
      setText("");
      if (data.message) setMessages((prev) => [...prev, data.message]);
      else await load();
    } catch {
      setError("Could not send");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/clubs/${clubId}/chat?id=${id}`, { method: "DELETE" });
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <Card className="bg-hl-panel border-hl-border overflow-hidden p-0 flex flex-col min-h-[320px] max-h-[480px]">
      <div className="border-b border-hl-border px-4 py-3 text-sm font-bold text-white flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-hl-gold" />
        Club chat
      </div>
      {!member ? (
        <div className="flex-1 px-4 py-8 text-sm text-hl-muted text-center">
          Join the club to read and send messages.
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-hl-muted">No messages yet.</p>
            ) : (
              messages.map((row) => {
                const label = row.playerName || row.username;
                return (
                  <div key={row.id} className="flex items-start gap-2">
                    <Avatar className="h-7 w-7 border border-hl-border mt-0.5">
                      {row.avatar ? <AvatarImage src={row.avatar} alt="" /> : null}
                      <AvatarFallback className="bg-hl-panel-light text-[9px] font-bold text-hl-gold">
                        {label.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        {row.playerName ? (
                          <Link
                            href={`/profile?player=${encodeURIComponent(row.playerName)}`}
                            className="text-xs font-bold text-white hover:text-hl-gold truncate"
                          >
                            {label}
                          </Link>
                        ) : (
                          <span className="text-xs font-bold text-white truncate">{label}</span>
                        )}
                        <span className="text-[10px] text-hl-muted shrink-0">
                          {new Date(row.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {owner || row.discordId === me ? (
                          <button
                            type="button"
                            onClick={() => remove(row.id)}
                            className="text-[10px] text-hl-muted hover:text-hl-red"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                      <p className="text-sm text-[#d0d0d0] whitespace-pre-wrap break-words">{row.message}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          <form
            className="border-t border-hl-border p-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 250))}
              placeholder="Message the club…"
              className="h-9 flex-1 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted focus:outline-none focus:border-hl-gold/50"
            />
            <button
              type="submit"
              disabled={busy || text.trim().length < 1}
              className="h-9 rounded-lg px-3 text-xs font-black header-caps find-match-btn text-hl-base disabled:opacity-50"
            >
              Send
            </button>
          </form>
          {error ? <p className="px-3 pb-3 text-xs text-hl-red">{error}</p> : null}
        </>
      )}
    </Card>
  );
}
