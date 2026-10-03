import { NextResponse } from "next/server";
import { getMatchesForPlayer, getPlayer } from "@/lib/db";
import { toProfileMatch } from "@/lib/profile-match";

const MAX_PAGE = 100;

/**
 * GET ?before=<match_history id>&limit=50 — a player's older ranked matches,
 * newest first: the profile's Match history "Load more".
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const player = await getPlayer(decodeURIComponent(name));
    if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    const url = new URL(request.url);
    const before = Number(url.searchParams.get("before"));
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 50)));
    const rows = await getMatchesForPlayer(
      player.name,
      limit,
      Number.isFinite(before) && before > 0 ? before : undefined
    );
    return NextResponse.json({
      matches: rows.map((m) => toProfileMatch(m, player.rank)),
      hasMore: rows.length === limit,
    });
  } catch (error) {
    console.error("player matches GET", error);
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 });
  }
}
