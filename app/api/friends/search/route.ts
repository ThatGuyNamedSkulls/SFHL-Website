import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchUsers } from "@/lib/social";

/** GET ?q= — search the user directory to add friends (excludes yourself). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ users: [] });
  const users = await searchUsers(q, session.discordId);
  return NextResponse.json({ users });
}
