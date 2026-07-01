import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** Returns the current logged-in user's session, or null */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({ user: session });
}
