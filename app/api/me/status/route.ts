import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { GET as lobbyGET } from "@/app/api/lobby/route";
import { GET as recentMatchesGET } from "@/app/api/matches/recent/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { GET as partiesGET } from "@/app/api/parties/route";
import { GET as queueGET } from "@/app/api/queue/route";
import { GET as subsGET } from "@/app/api/subs/route";

export const dynamic = "force-dynamic";

/**
 * GET — everything the site shell polls, in one function call
 * (docs/PERFORMANCE_PLAN.md step 4): the same answers as the separate
 * endpoints, keyed by their URL. The browser's status poller
 * (components/status-poller.tsx) puts each one into the client request cache,
 * so the bell, party rail, queue pill, VS panel and sidebar read it instead of
 * each calling the server.
 */
const PARTS: Record<string, (origin: string) => Promise<Response>> = {
  "/api/notifications": () => notificationsGET(),
  "/api/parties?mine=1": (origin) => partiesGET(new Request(`${origin}/api/parties?mine=1`)),
  "/api/queue": (origin) => queueGET(new Request(`${origin}/api/queue`)),
  "/api/lobby": () => lobbyGET(),
  "/api/matches/recent": () => recentMatchesGET(),
  "/api/subs": () => subsGET(),
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ at: Date.now(), parts: {} });
  const origin = new URL(request.url).origin;
  const entries = await Promise.all(
    Object.entries(PARTS).map(async ([url, run]) => {
      try {
        const res = await run(origin);
        return [url, { status: res.status, json: await res.json() }] as const;
      } catch {
        return [url, null] as const; // that part falls back to its own endpoint
      }
    })
  );
  return NextResponse.json({ at: Date.now(), parts: Object.fromEntries(entries.filter(([, v]) => v !== null)) });
}
