"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Inbox, KeyRound, Link2, Pencil, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { RankBadge } from "@/components/rank-badge";
import { useClan } from "@/components/clans/clan-context";
import { ClanPreview, ClanProfileFields, type ClanDraft } from "@/components/clans/clan-form";
import {
  BTN_DANGER,
  BTN_LINE,
  BTN_PRIMARY,
  BTN_SM,
  BTN_SOFT,
  BoxHead,
  ConfirmDialog,
  INPUT,
  NativeSelect,
  PANEL,
  PlayerAvatar,
  RoleChip,
} from "@/components/clans/ui";
import { clanHref, shortAgo } from "@/lib/clan-ui";
import { flagPath, isValidCountry } from "@/lib/countries";
import { profileHref } from "@/lib/profile-link";
import type { RankTierLetter } from "@/types";

const PERMS = [
  { key: "canInvite", label: "Invites and requests" },
  { key: "canKick", label: "Remove members" },
  { key: "canPromote", label: "Change roles" },
  { key: "canEdit", label: "Edit profile" },
] as const;

function Box({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`${PANEL} scroll-mt-20`}>
      {children}
    </section>
  );
}

function Requests() {
  const { data, busy, act, now, isOnline } = useClan();
  const club = data.club;
  return (
    <Box id="clan-requests">
      <BoxHead title="Join requests">{club.requests.length} waiting</BoxHead>
      {!club.private ? (
        <p className="px-4 py-5 text-sm text-[#8a8a8a]">The clan is open: players join directly. Requests come in when it&apos;s invite only.</p>
      ) : club.requests.length === 0 ? (
        <p className="px-4 py-5 text-sm text-[#8a8a8a]">No one is waiting.</p>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {club.requests.map((r) => {
            const name = r.playerName || r.username;
            return (
              <div key={r.discordId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 md:grid-cols-[minmax(0,1fr)_8.125rem_6.875rem_auto] md:px-4">
                <span className="flex min-w-0 items-center gap-[0.6875rem]">
                  <PlayerAvatar name={name} src={r.avatar} size={32} online={isOnline({ name })} />
                  <span className="min-w-0">
                    {r.playerName ? (
                      <Link href={profileHref(r.playerName)} className="block truncate font-semibold text-[#ededed] hover:text-white">
                        {name}
                      </Link>
                    ) : (
                      <b className="block truncate font-semibold text-[#ededed]">{name}</b>
                    )}
                    <small className="flex items-center gap-1.5 text-xs text-[#8a8a8a]">
                      {r.country && isValidCountry(r.country) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={flagPath(r.country) ?? undefined} alt="" className="h-2.5 w-[0.9375rem] rounded-[2px] object-cover" />
                      ) : null}
                      <span className="md:hidden">{shortAgo(r.createdAt, now)}</span>
                      <span className="hidden md:inline">{isOnline({ name }) ? "Online" : "Offline"}</span>
                    </small>
                  </span>
                </span>
                <span className="hidden items-center gap-2 font-semibold tabular-nums text-[#ededed] md:flex">
                  <RankBadge rank={(r.placementDone ? r.rank : "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5" />
                  {r.placementDone ? r.elo.toLocaleString() : <span className="font-normal text-[#8a8a8a]">In placement</span>}
                </span>
                <span className="hidden text-[0.8125rem] text-[#8a8a8a] md:block">{shortAgo(r.createdAt, now)}</span>
                <span className="flex gap-1.5 justify-self-end">
                  <button
                    type="button"
                    className={`${BTN_PRIMARY} ${BTN_SM}`}
                    disabled={busy}
                    onClick={() => void act(`/api/clubs/${club.id}/join-requests`, "POST", { discordId: r.discordId, accept: true })}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className={`${BTN_LINE} ${BTN_SM}`}
                    disabled={busy}
                    onClick={() => void act(`/api/clubs/${club.id}/join-requests`, "POST", { discordId: r.discordId, accept: false })}
                  >
                    Decline
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {club.private ? (
        <p className="border-t border-white/[0.05] px-4 py-3 text-xs text-[#8a8a8a]">Declined players can ask again after 24 hours.</p>
      ) : null}
    </Box>
  );
}

function Invites() {
  const { data, busy, act, now, notify } = useClan();
  const club = data.club;
  const link = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}${clanHref(club.tag)}?invite=${token}`;
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(link(token));
      notify("Invite link copied");
    } catch {
      notify("Couldn't copy the link");
    }
  };
  return (
    <Box id="clan-invites">
      <BoxHead title="Invite links">
        <button type="button" className={`${BTN_LINE} ${BTN_SM}`} disabled={busy} onClick={() => void act(`/api/clubs/${club.id}/invite`)}>
          <Plus className="h-3.5 w-3.5" /> New link
        </button>
      </BoxHead>
      {club.invites.length === 0 ? (
        <p className="px-4 py-5 text-sm text-[#8a8a8a]">No invite links yet.</p>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {club.invites.map((inv) => (
            <div key={inv.token} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 md:grid-cols-[minmax(0,1fr)_6.875rem_6.25rem_auto] md:px-4">
              <code className="truncate font-mono text-[0.78rem] text-[#bdbdbd]">{link(inv.token).replace(/^https?:\/\//, "")}</code>
              <span className="hidden text-[0.8125rem] text-[#bdbdbd] md:block">{inv.createdByName ?? "A former member"}</span>
              <span className="hidden text-[0.8125rem] text-[#8a8a8a] md:block">{shortAgo(inv.createdAt, now)}</span>
              <span className="flex gap-1.5 justify-self-end">
                <button type="button" className={`${BTN_SOFT} ${BTN_SM}`} onClick={() => void copy(inv.token)}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
                <button
                  type="button"
                  className={`${BTN_LINE} ${BTN_SM} !w-[1.875rem] !px-0`}
                  disabled={busy}
                  title="Turn this link off"
                  aria-label="Turn this link off"
                  onClick={() => void act(`/api/clubs/${club.id}/invite?token=${encodeURIComponent(inv.token)}`, "DELETE")}
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="border-t border-white/[0.05] px-4 py-3 text-xs text-[#8a8a8a]">
        Anyone with a link joins straight away, even while the clan is invite only. A clan keeps its five newest links.
      </p>
    </Box>
  );
}

function Profile() {
  const { data, me, perms, busy, act, notify } = useClan();
  const club = data.club;
  const initial: ClanDraft = {
    name: club.name,
    tag: club.tag,
    description: club.description,
    rules: club.rules,
    logoUrl: club.logoUrl ?? "",
    accentColor: club.accentColor,
    private: club.private,
    region: club.region,
  };
  const [draft, setDraft] = useState<ClanDraft>(initial);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const myName = club.members.find((m) => m.discordId === me)?.playerName ?? null;

  const save = async () => {
    // Name, tag and joining are owner-only: staff send just what they may change.
    const body: Record<string, unknown> = {
      description: draft.description,
      rules: draft.rules,
      accentColor: draft.accentColor,
      logoUrl: draft.logoUrl.trim() ? draft.logoUrl.trim() : null,
    };
    if (perms.owner) Object.assign(body, { name: draft.name, tag: draft.tag, private: draft.private });
    if (await act(`/api/clubs/${club.id}`, "PATCH", body)) notify("Clan profile saved");
  };

  return (
    <Box id="clan-profile">
      <BoxHead title="Clan profile">{perms.owner ? null : <span>Name, tag and joining: owner only</span>}</BoxHead>
      <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <ClanProfileFields value={draft} onChange={setDraft} ownerOnly={!perms.owner} />
        <ClanPreview value={draft} playerName={myName} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-4 py-3">
        <small className="mr-auto text-xs text-[#8a8a8a]">{changed ? "Unsaved changes" : "Changes show on the clan page once saved."}</small>
        <button type="button" className={BTN_LINE} disabled={!changed || busy} onClick={() => setDraft(initial)}>
          Cancel
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!changed || busy || draft.name.trim().length < 3 || draft.tag.length < 2}
          onClick={() => void save()}
        >
          Save changes
        </button>
      </div>
    </Box>
  );
}

function Roles() {
  const { data, perms, busy, act } = useClan();
  const club = data.club;
  const [newRole, setNewRole] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const counts = (id: string) => club.members.filter((m) => m.role === id).length;
  const cell = (on: boolean, locked: boolean, onClick?: () => void) => (
    <button
      type="button"
      disabled={locked || busy || !onClick}
      onClick={onClick}
      aria-pressed={on}
      className={`inline-grid h-[1.125rem] w-[1.125rem] place-items-center rounded-[5px] border-[1.5px] ${
        locked ? "border-[#2a2a2a] bg-[#2a2a2a] text-[#777]" : on ? "border-[#e8e8e8] bg-[#e8e8e8] text-[#111]" : "border-[#4a4a4a]"
      } ${onClick && !locked ? "cursor-pointer" : "cursor-default"}`}
    >
      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
  const COLS = "grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_5rem]";
  return (
    <Box id="clan-roles">
      <BoxHead title="Roles">Up to 7. Higher roles manage lower ones.</BoxHead>
      <div className={`grid h-[2.375rem] items-center gap-3 border-b border-white/[0.07] px-3.5 text-xs font-medium text-[#8a8a8a] md:px-4 ${COLS}`}>
        <span>Role</span>
        {PERMS.map((p) => (
          <span key={p.key} className="text-center">
            {p.label}
          </span>
        ))}
        <span className="hidden text-right md:block">Members</span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {club.roles.map((r) => {
          const locked = r.builtin || !perms.owner;
          return (
            <div key={r.id} className={`grid min-h-12 items-center gap-3 px-3.5 md:px-4 ${COLS}`}>
              <span className="flex min-w-0 items-center gap-1.5">
                {renaming?.id === r.id ? (
                  <form
                    className="flex min-w-0 gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(`/api/clubs/${club.id}/roles`, "PATCH", { roleId: r.id, name: renaming.name }).then((ok) => ok && setRenaming(null));
                    }}
                  >
                    <input
                      autoFocus
                      className={`${INPUT} !h-8 min-w-0`}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: r.id, name: e.target.value.slice(0, 24) })}
                    />
                    <button type="submit" className={`${BTN_SOFT} ${BTN_SM}`} disabled={busy || renaming.name.trim().length < 2}>
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    <RoleChip roleId={r.id} name={r.name} color={club.accentColor} />
                    {perms.owner && !r.builtin ? (
                      <>
                        <button type="button" className="text-[#8a8a8a] hover:text-white" title="Rename" onClick={() => setRenaming({ id: r.id, name: r.name })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="text-[#8a8a8a] hover:text-[#f08a7f]" title="Remove role" onClick={() => setRemoving({ id: r.id, name: r.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </span>
              {PERMS.map((p) => (
                <span key={p.key} className="text-center">
                  {cell(
                    r.id === "owner" || !!r[p.key],
                    locked,
                    locked ? undefined : () => void act(`/api/clubs/${club.id}/roles`, "PATCH", { roleId: r.id, [p.key]: !r[p.key] })
                  )}
                </span>
              ))}
              <span className="hidden text-right tabular-nums text-[#bdbdbd] md:block">{counts(r.id)}</span>
            </div>
          );
        })}
      </div>
      {perms.owner ? (
        club.roles.length < 7 ? (
          <form
            className="flex gap-2 border-t border-white/[0.05] px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act(`/api/clubs/${club.id}/roles`, "POST", { name: newRole }).then((ok) => ok && setNewRole(""));
            }}
          >
            <input
              className={`${INPUT} max-w-[18.75rem]`}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value.slice(0, 24))}
              placeholder="New role, e.g. Captain or Coach"
              aria-label="New role name"
            />
            <button type="submit" className={BTN_LINE} disabled={busy || newRole.trim().length < 2}>
              <Plus className="h-4 w-4" /> Add role
            </button>
          </form>
        ) : (
          <p className="border-t border-white/[0.05] px-4 py-3 text-xs text-[#8a8a8a]">The clan has the maximum of 7 roles.</p>
        )
      ) : (
        <p className="border-t border-white/[0.05] px-4 py-3 text-xs text-[#8a8a8a]">Only the owner changes roles.</p>
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove the ${removing?.name ?? ""} role?`}
        body="Members with it become Members."
        confirmLabel="Remove role"
        danger
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const id = removing.id;
          setRemoving(null);
          void act(`/api/clubs/${club.id}/roles?roleId=${encodeURIComponent(id)}`, "DELETE");
        }}
      />
    </Box>
  );
}

function Danger() {
  const { data, me, busy, act } = useClan();
  const club = data.club;
  const others = club.members.filter((m) => m.discordId !== me);
  const [to, setTo] = useState("");
  const [confirm, setConfirm] = useState<"transfer" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const target = others.find((m) => m.discordId === to);
  return (
    <section id="clan-danger" className="scroll-mt-20 rounded-[0.625rem] border border-[#e74c3c]/25 bg-[#1c1c1c]">
      <div>
        <BoxHead title="Danger zone" />
        <div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between">
          <div>
            <b className="block font-semibold text-[#ededed]">Transfer ownership</b>
            <small className="block text-[0.8125rem] text-[#8a8a8a]">Give the clan to another member. You stay in it as a Member.</small>
          </div>
          <span className="flex gap-2">
            <NativeSelect value={to} onChange={(e) => setTo(e.target.value)} aria-label="New owner" className="min-w-[11rem]">
              <option value="">Choose a member</option>
              {others.map((m) => (
                <option key={m.discordId} value={m.discordId}>
                  {m.playerName || m.username}
                </option>
              ))}
            </NativeSelect>
            <button type="button" className={BTN_LINE} disabled={!target || busy} onClick={() => setConfirm("transfer")}>
              <KeyRound className="h-4 w-4" /> Transfer
            </button>
          </span>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.05] px-4 py-3.5 md:flex-row md:items-center md:justify-between">
          <div>
            <b className="block font-semibold text-[#ededed]">Delete clan</b>
            <small className="block text-[0.8125rem] text-[#8a8a8a]">
              Deletes the clan, its chat and its invite links for everyone. This can&apos;t be undone.
            </small>
          </div>
          <button type="button" className={BTN_DANGER} onClick={() => setConfirm("delete")}>
            <Trash2 className="h-4 w-4" /> Delete clan
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm === "transfer"}
        title={`Make ${target ? target.playerName || target.username : ""} the owner?`}
        body="They get every permission and you become a Member. Only they can give the clan back."
        confirmLabel="Transfer ownership"
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          if (target) void act(`/api/clubs/${club.id}/transfer`, "POST", { discordId: target.discordId });
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Delete ${club.name}?`}
        body={
          <>
            Type <b className="text-[#ededed]">{club.name}</b> to confirm. The clan, its chat and its invite links are gone for good.
          </>
        }
        confirmLabel="Delete clan"
        danger
        busy={busy || typed.trim() !== club.name}
        onCancel={() => {
          setConfirm(null);
          setTyped("");
        }}
        onConfirm={() => {
          setConfirm(null);
          setTyped("");
          void act(`/api/clubs/${club.id}`, "DELETE");
        }}
      >
        <input className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={club.name} aria-label="Clan name" />
      </ConfirmDialog>
    </section>
  );
}

/**
 * Manage (§4.14), for staff only: join requests, invite links, the clan
 * profile with a preview, roles × permissions, and (owner) the danger zone.
 */
export function ManageTab() {
  const { data, perms } = useClan();
  const club = data.club;
  const sections = [
    perms.invite && { id: "clan-requests", label: "Join requests", icon: Inbox, count: club.requests.length },
    perms.invite && { id: "clan-invites", label: "Invite links", icon: Link2 },
    perms.edit && { id: "clan-profile", label: "Clan profile", icon: Pencil },
    { id: "clan-roles", label: "Roles", icon: KeyRound },
    perms.owner && { id: "clan-danger", label: "Danger zone", icon: ShieldAlert },
  ].filter(Boolean) as { id: string; label: string; icon: typeof Inbox; count?: number }[];

  return (
    <div className="grid items-start gap-5 md:grid-cols-[12.5rem_minmax(0,1fr)]">
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:sticky md:top-3 md:mx-0 md:flex-col md:gap-px md:px-0 [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border border-white/[0.07] px-2.5 py-2 text-[0.8125rem] font-medium text-[#bdbdbd] hover:bg-white/[0.04] hover:text-white md:border-0"
          >
            <s.icon className="h-4 w-4 text-[#8a8a8a]" />
            {s.label}
            {s.count ? (
              <span className="ml-auto grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[5px] bg-[#ff5500] px-1 text-[0.6875rem] font-bold text-white">
                {s.count}
              </span>
            ) : null}
          </a>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-5">
        {perms.invite ? <Requests /> : null}
        {perms.invite ? <Invites /> : null}
        {perms.edit ? <Profile key={`${club.name}|${club.tag}|${club.description}|${club.rules}|${club.accentColor}|${club.logoUrl}|${club.private}`} /> : null}
        <Roles />
        {perms.owner ? <Danger /> : null}
      </div>
    </div>
  );
}
