/**
 * Team roster slots (docs/LEAGUE_V2_PLAN.md D2): at most 5 main-roster players
 * (the captain is one of them), 6 subs and 1 coach — 12 members. The league
 * roster is the players (starters + subs); a coach doesn't play. Pure, so the
 * team page and the Find pages can show the slots in the browser.
 */

export type TeamRole = "captain" | "starter" | "sub" | "coach";
/** A roster slot: the captain takes a starter slot. */
export type RosterSlot = "starter" | "sub" | "coach";

export const ROLE_LIMITS: Record<RosterSlot, number> = { starter: 5, sub: 6, coach: 1 };
export const MAX_TEAM_MEMBERS = ROLE_LIMITS.starter + ROLE_LIMITS.sub + ROLE_LIMITS.coach;

export const ROLE_LABEL: Record<TeamRole, string> = {
  captain: "Captain",
  starter: "Main roster",
  sub: "Substitute",
  coach: "Coach",
};

interface Member {
  discordId: string;
  role: string;
  status: string;
}

export function slotOf(role: string): RosterSlot {
  if (role === "sub" || role === "coach") return role;
  return "starter";
}

/** Filled slots, counting accepted members and open invites (an invite holds its slot). */
export function slotCounts(members: Member[], exceptId?: string): Record<RosterSlot, number> {
  const out: Record<RosterSlot, number> = { starter: 0, sub: 0, coach: 0 };
  for (const m of members) {
    if (m.discordId === exceptId) continue;
    if (m.status !== "accepted" && m.status !== "invited") continue;
    out[slotOf(m.role)] += 1;
  }
  return out;
}

export function hasRoom(members: Member[], slot: RosterSlot, exceptId?: string): boolean {
  return slotCounts(members, exceptId)[slot] < ROLE_LIMITS[slot];
}

/** The slot a new player gets: the main roster while it has room, then the bench. A coach is only picked on purpose. */
export function openSlot(members: Member[]): RosterSlot | null {
  if (hasRoom(members, "starter")) return "starter";
  if (hasRoom(members, "sub")) return "sub";
  return null;
}

/** Players who can play league matches: everyone but the coach. */
export function isPlayer(role: string): boolean {
  return role !== "coach";
}

export function fullMessage(slot: RosterSlot): string {
  return slot === "starter"
    ? `The main roster is full (${ROLE_LIMITS.starter} players).`
    : slot === "sub"
      ? `The bench is full (${ROLE_LIMITS.sub} substitutes).`
      : "The team already has a coach.";
}
