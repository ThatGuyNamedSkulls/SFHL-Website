import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clubsForMember } from "@/lib/clubs";
import { client } from "@/lib/db";
import { listTournaments } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

interface SidebarClub {
  id: string;
  name: string;
  tag: string;
  accentColor: string;
  logoUrl: string | null;
  activityAt: number;
  chatTimes: number[];
  tournaments: { name: string; createdAt: number }[];
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.discordId) return NextResponse.json({ clubs: [] });

    const mine = await clubsForMember(session.discordId);
    if (mine.length === 0) return NextResponse.json({ clubs: [] });

    const ids = mine.map((c) => c.id);
    const chatTimes = new Map<string, number[]>();
    try {
      const placeholders = ids.map(() => "?").join(",");
      const rs = await client.execute({
        sql: `SELECT club_id, created_at FROM web_club_chat
              WHERE club_id IN (${placeholders})
              ORDER BY created_at DESC`,
        args: ids,
      });
      for (const row of rs.rows as unknown as { club_id: string; created_at: number }[]) {
        const list = chatTimes.get(row.club_id) ?? [];
        if (list.length < 30) list.push(Number(row.created_at) || 0);
        chatTimes.set(row.club_id, list);
      }
    } catch {
      /* chat table may not exist yet */
    }

    let cups: { clubId: string | null; name: string; createdAt: number }[] = [];
    try {
      cups = (await listTournaments())
        .filter((t) => t.clubId && ids.includes(t.clubId))
        .map((t) => ({ clubId: t.clubId, name: t.name, createdAt: t.createdAt }));
    } catch {
      cups = [];
    }

    const ranked: SidebarClub[] = mine.map((club) => {
      const times = chatTimes.get(club.id) ?? [];
      const clubCups = cups.filter((c) => c.clubId === club.id);
      const activityAt = Math.max(
        club.updatedAt || 0,
        times[0] || 0,
        ...clubCups.map((c) => c.createdAt || 0)
      );
      return {
        id: club.id,
        name: club.name,
        tag: club.tag,
        accentColor: club.accentColor,
        logoUrl: club.logoUrl,
        activityAt,
        chatTimes: times,
        tournaments: clubCups.map((c) => ({ name: c.name, createdAt: c.createdAt })),
      };
    });
    ranked.sort((a, b) => b.activityAt - a.activityAt);

    return NextResponse.json({ clubs: ranked.slice(0, 3) });
  } catch (error) {
    console.error("clubs sidebar", error);
    return NextResponse.json({ clubs: [] });
  }
}
