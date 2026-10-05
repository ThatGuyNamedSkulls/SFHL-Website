/**
 * Who may use the staff panel (/staff and app/api/staff/*): Match Staff, a
 * server Administrator, or the MatchMaking Manager role. Each action then needs its own role (lib/staff-jobs.ts),
 * and the bot checks the Discord roles again before running it.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isGuildAdmin, isMatchStaff, isMmManager } from "@/lib/discord-party-voice";
import type { StaffActor, StaffRoles } from "@/lib/staff-jobs";

export async function staffRoles(discordId: string): Promise<StaffRoles> {
  const [staff, admin, manager] = await Promise.all([
    isMatchStaff(discordId).catch(() => false),
    isGuildAdmin(discordId).catch(() => false),
    isMmManager(discordId).catch(() => false),
  ]);
  return { staff, admin, manager };
}

/** Any of the staff panel's roles. */
export function isAnyStaff(roles: StaffRoles): boolean {
  return roles.staff || roles.admin || roles.manager;
}

/** The signed-in staff member, or the 401/403 answer to send instead. */
export async function staffContext(): Promise<{ actor: StaffActor; roles: StaffRoles } | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const roles = await staffRoles(session.discordId);
  if (!isAnyStaff(roles)) {
    return NextResponse.json({ error: "Staff only." }, { status: 403 });
  }
  return {
    actor: { discordId: session.discordId, name: session.playerName || session.username },
    roles,
  };
}
