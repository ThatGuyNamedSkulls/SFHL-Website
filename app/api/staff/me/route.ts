import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { staffRoles } from "@/lib/staff-session";

export const dynamic = "force-dynamic";

/** { staff, admin, manager } for the signed-in user — the profile menu shows "Staff panel" when either is true. */
export async function GET() {
  const session = await getSession();
  const roles = session ? await staffRoles(session.discordId) : { staff: false, admin: false, manager: false };
  return NextResponse.json(roles, { headers: { "Cache-Control": "private, no-store" } });
}
