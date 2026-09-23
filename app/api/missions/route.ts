import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { claimMission, listMissionsForPlayer } from "@/lib/missions";
import { getPlayerCoins } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getSession();
    const playerName = session?.playerName ?? null;
    const missions = await listMissionsForPlayer(playerName);
    const coins = playerName ? await getPlayerCoins(playerName) : 0;
    return NextResponse.json({
      linked: !!playerName,
      coins,
      missions,
    });
  } catch (error) {
    console.error("missions GET", error);
    return NextResponse.json({ missions: [], coins: 0, linked: false });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.playerName) {
    return NextResponse.json({ error: "Link a HyperLeague player to claim rewards." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const missionId = String(body.missionId || "");
  if (!missionId) return NextResponse.json({ error: "Missing mission." }, { status: 400 });
  const result = await claimMission(session.playerName, missionId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const missions = await listMissionsForPlayer(session.playerName);
  return NextResponse.json({ ok: true, coins: result.coins, reward: result.reward, missions });
}
