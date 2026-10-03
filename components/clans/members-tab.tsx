"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Crown, KeyRound, MoreHorizontal, Search, UserMinus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RankBadge } from "@/components/rank-badge";
import { useClan } from "@/components/clans/clan-context";
import { ConfirmDialog, INPUT, NativeSelect, PANEL, PlayerAvatar, RoleChip, TaggedName } from "@/components/clans/ui";
import type { ClanMember } from "@/components/clans/types";
import { flagPath, isValidCountry } from "@/lib/countries";
import { profileHref } from "@/lib/profile-link";
import type { RankTierLetter } from "@/types";

type Sort = "role" | "elo" | "joined";
const PAGE = 50;
const COLS =
  "grid-cols-[minmax(0,1fr)_auto_1.75rem] md:grid-cols-[minmax(0,2.4fr)_7.5rem_9.375rem_8.125rem_7.5rem_2rem]";

/**
 * Members (§4.10): one list with role, rank and Elo, matches with the clan this
 * season and when they joined. Staff get a menu per row for the members below
 * them: change role, transfer ownership (owner), remove.
 */
export function MembersTab() {
  const { data, me, perms, busy, act, isOnline } = useClan();
  const club = data.club;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [sort, setSort] = useState<Sort>("role");
  const [shown, setShown] = useState(PAGE);
  const [confirm, setConfirm] = useState<{ kind: "kick" | "transfer"; member: ClanMember } | null>(null);

  const rankOf = (roleId: string) => club.roles.find((r) => r.id === roleId)?.rank ?? 100;
  const nameOf = (m: ClanMember) => m.playerName || m.username;
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = club.members.filter((m) => (role === "all" || m.role === role) && (!q || nameOf(m).toLowerCase().includes(q)));
    const by: Record<Sort, (a: ClanMember, b: ClanMember) => number> = {
      role: (a, b) => rankOf(a.role) - rankOf(b.role) || b.elo - a.elo,
      elo: (a, b) => b.elo - a.elo,
      joined: (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0),
    };
    return [...rows].sort((a, b) => by[sort](a, b) || nameOf(a).localeCompare(nameOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.members, query, role, sort]);

  const assignable = club.roles.filter((r) => r.id !== "owner" && (perms.owner || r.rank > perms.rank));
  const online = club.members.filter((m) => isOnline({ name: nameOf(m) })).length;
  const ranked = club.members.filter((m) => m.placementDone).length;

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.07] px-4 py-3">
        <label className="relative block min-w-[12.5rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]" />
          <input className={`${INPUT} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members" />
        </label>
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="all">All roles</option>
          {club.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="role">Sort by role</option>
          <option value="elo">Sort by Elo</option>
          <option value="joined">Sort by joined</option>
        </NativeSelect>
        <span className="ml-auto text-xs text-[#8a8a8a]">
          {club.members.length} members · {ranked} ranked · {online} online
        </span>
      </div>

      <div className={`hidden h-[2.375rem] items-center gap-3.5 border-b border-white/[0.07] px-4 text-xs font-medium text-[#8a8a8a] md:grid ${COLS}`}>
        <span>Player</span>
        <span>Role</span>
        <span>Skill · Elo</span>
        <span className="text-right">Matches together</span>
        <span>Joined</span>
        <span />
      </div>

      {list.length === 0 ? <p className="px-4 py-6 text-sm text-[#8a8a8a]">No members match.</p> : null}
      <div className="divide-y divide-white/[0.05]">
        {list.slice(0, shown).map((m) => {
          const name = nameOf(m);
          const on = isOnline({ name });
          const mine = m.discordId === me;
          const roleName = club.roles.find((r) => r.id === m.role)?.name ?? m.role;
          const manageable =
            !mine && m.role !== "owner" && (perms.owner || ((perms.kick || perms.promote) && rankOf(m.role) > perms.rank));
          return (
            <div key={m.discordId} className={`grid min-h-14 items-center gap-x-3.5 gap-y-1 px-3.5 py-2 md:px-4 ${COLS} ${mine ? "bg-white/[0.025]" : ""}`}>
              <span className="flex min-w-0 items-center gap-[0.6875rem]">
                <PlayerAvatar name={name} src={m.avatar} size={32} online={on} />
                <span className="min-w-0">
                  {m.playerName ? (
                    <Link href={profileHref(m.playerName)} className="block truncate font-semibold text-[#ededed] hover:text-white">
                      <TaggedName tag={club.tag} name={name} />
                      {mine ? <span className="font-normal text-[#8a8a8a]"> (you)</span> : null}
                    </Link>
                  ) : (
                    <b className="block truncate font-semibold text-[#ededed]">
                      <TaggedName tag={club.tag} name={name} />
                    </b>
                  )}
                  <small className="flex items-center gap-1.5 truncate text-xs text-[#8a8a8a]">
                    {m.country && isValidCountry(m.country) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={flagPath(m.country) ?? undefined} alt="" className="h-2.5 w-[0.9375rem] rounded-[2px] object-cover" />
                    ) : null}
                    <span className={on ? "text-[#2ecc71]" : ""}>{on ? "Online" : "Offline"}</span>
                    <span className="md:hidden">· {roleName}</span>
                  </small>
                </span>
              </span>
              <span className="hidden md:block">
                <RoleChip roleId={m.role} name={roleName} color={club.accentColor} />
              </span>
              <span className="flex items-center gap-2 font-semibold tabular-nums text-[#ededed]">
                <RankBadge rank={(m.placementDone ? m.rank : "UNRANKED") as RankTierLetter} size="sm" showGlow={false} className="!h-5 !w-5" />
                {m.placementDone ? m.elo.toLocaleString() : <span className="font-normal text-[#8a8a8a]">In placement</span>}
              </span>
              <span className="hidden text-right font-semibold tabular-nums text-[#ededed] md:block">{m.together}</span>
              <span className="hidden text-[0.8125rem] text-[#bdbdbd] md:block">
                {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
              </span>
              <span className="justify-self-end">
                {manageable ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Manage ${name}`}
                      className="grid h-7 w-7 place-items-center rounded-md text-[#8a8a8a] outline-none hover:bg-white/[0.06] hover:text-white"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 border border-white/10 bg-[#1e1e1e] p-1 text-[#ededed]">
                      {perms.promote && assignable.length ? (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2.5 px-2.5 py-2">
                            <Crown className="h-4 w-4 text-[#8a8a8a]" /> Change role
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-44 border border-white/10 bg-[#1e1e1e] p-1 text-[#ededed]">
                            {assignable.map((r) => (
                              <DropdownMenuItem
                                key={r.id}
                                disabled={busy || r.id === m.role}
                                className="cursor-pointer px-2.5 py-2"
                                onClick={() => void act(`/api/clubs/${club.id}/roles`, "POST", { discordId: m.discordId, roleId: r.id })}
                              >
                                {r.name}
                                {r.id === m.role ? <span className="ml-auto text-xs text-[#8a8a8a]">current</span> : null}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ) : null}
                      {perms.owner ? (
                        <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2" onClick={() => setConfirm({ kind: "transfer", member: m })}>
                          <KeyRound className="h-4 w-4 text-[#8a8a8a]" /> Transfer ownership
                        </DropdownMenuItem>
                      ) : null}
                      {perms.kick ? (
                        <>
                          <DropdownMenuSeparator className="bg-white/[0.07]" />
                          <DropdownMenuItem className="cursor-pointer gap-2.5 px-2.5 py-2 text-[#f08a7f]" onClick={() => setConfirm({ kind: "kick", member: m })}>
                            <UserMinus className="h-4 w-4" /> Remove from clan
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {list.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="w-full border-t border-white/[0.07] py-2.5 text-[0.8125rem] font-semibold text-[#bdbdbd] hover:text-white"
        >
          Show more · {shown} of {list.length}
        </button>
      ) : null}

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === "transfer"
            ? `Make ${confirm ? nameOf(confirm.member) : ""} the owner?`
            : `Remove ${confirm ? nameOf(confirm.member) : ""}?`
        }
        body={
          confirm?.kind === "transfer"
            ? "They get every permission and you become a Member. Only they can give the clan back."
            : "They leave the clan and lose its tag. They can come back by joining again (or with an invite)."
        }
        confirmLabel={confirm?.kind === "transfer" ? "Transfer ownership" : "Remove"}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const path = confirm.kind === "transfer" ? "transfer" : "kick";
          setConfirm(null);
          void act(`/api/clubs/${club.id}/${path}`, "POST", { discordId: confirm.member.discordId });
        }}
      />
    </section>
  );
}
