"use client";

import { createContext, useContext } from "react";
import type { ClanData, ClanMember } from "@/components/clans/types";

/** What the viewer may do in this clan (the owner can do everything). */
export interface ClanPerms {
  member: boolean;
  owner: boolean;
  invite: boolean;
  kick: boolean;
  promote: boolean;
  edit: boolean;
  /** Any staff permission: shows the Manage tab. */
  staff: boolean;
  /** The viewer's role rank (lower is higher; the owner is -1, outsiders 999). */
  rank: number;
}

export interface ClanContextValue {
  data: ClanData;
  me: string | null;
  myMember: ClanMember | null;
  perms: ClanPerms;
  now: number;
  busy: boolean;
  isOnline: (m: { name?: string | null; id?: string | null }) => boolean;
  /** Runs a clan action; the response replaces the page data. False on failure (the error shows on the page). */
  act: (path: string, method?: string, body?: unknown) => Promise<boolean>;
  /** Shows a short message under the header. */
  notify: (message: string) => void;
}

export const ClanContext = createContext<ClanContextValue | null>(null);

export function useClan(): ClanContextValue {
  const ctx = useContext(ClanContext);
  if (!ctx) throw new Error("useClan must be used inside the clan page");
  return ctx;
}

export function permsFor(data: ClanData, me: string | null): ClanPerms {
  const club = data.club;
  const myMember = me ? club.members.find((m) => m.discordId === me) ?? null : null;
  const owner = !!me && club.ownerId === me;
  const role = myMember ? club.roles.find((r) => r.id === myMember.role) : undefined;
  const p = {
    member: !!myMember,
    owner,
    invite: owner || !!role?.canInvite,
    kick: owner || !!role?.canKick,
    promote: owner || !!role?.canPromote,
    edit: owner || !!role?.canEdit,
  };
  return { ...p, staff: p.invite || p.kick || p.promote || p.edit, rank: owner ? -1 : role?.rank ?? 999 };
}
