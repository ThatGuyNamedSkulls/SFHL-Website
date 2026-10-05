/**
 * The staff panel's Queue tab (CBL bot docs/STAFF_PANEL_PLAN.md step 6): which
 * region queues are open and in which mode, who is waiting, the queue format,
 * the server link queued for each region's next match, where each region's
 * queue post is, and the live matches (for their server link). Changes go
 * through the bot's /queue commands (lib/staff-jobs.ts).
 */
import { client, countWebQueueByRegion, getQueueGate, getQueueTeamSize } from "@/lib/db";
import { QUEUE_REGIONS } from "@/lib/regions";

/** Same window as lib/lobby.ts: a lobby row older than this is a dead match. */
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface StaffQueueRegion {
  id: string;
  label: string;
  open: boolean;
  /** The open modes ("standard", "super"). */
  modes: string[];
  waiting: number;
  /** The VIP link queued for this region's next match. */
  nextServer: string | null;
  /** The channel the region's queue post is in, while it's open. */
  postChannelId: string | null;
}

export interface StaffLiveMatch {
  id: string;
  matchNumber: number | null;
  map: string | null;
  region: string | null;
  queueMode: string | null;
  createdAt: number;
  serverUrl: string | null;
}

export interface StaffQueueView {
  teamSize: number;
  regions: StaffQueueRegion[];
  liveMatches: StaffLiveMatch[];
  /** Where the website last opened a queue (the bot remembers it). */
  lastChannelId: string | null;
}

type Row = Record<string, unknown>;

async function rows(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try {
    return (await client.execute({ sql, args })).rows as unknown as Row[];
  } catch {
    return [];
  }
}

/** A web_lobbies row for the server-link picker (league rooms too); null if broken. */
export function liveMatch(id: string, data: string, createdAt: number): StaffLiveMatch | null {
  let lobby: Record<string, unknown>;
  try {
    lobby = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const number = Number(lobby.matchNumber);
  const server = lobby.server as { url?: unknown } | null | undefined;
  return {
    id,
    matchNumber: Number.isInteger(number) && number > 0 ? number : null,
    map: (lobby.selectedMap as string) || (lobby.map as string) || null,
    region: (lobby.region as string) || null,
    queueMode: (lobby.queueMode as string) || null,
    createdAt: Number(lobby.createdAt) || createdAt,
    serverUrl: server && typeof server.url === "string" && server.url ? server.url : null,
  };
}

export async function staffQueueView(now = Date.now()): Promise<StaffQueueView> {
  const [gate, teamSize, waiting, state, lobbies] = await Promise.all([
    getQueueGate(),
    getQueueTeamSize(),
    countWebQueueByRegion(),
    rows(
      `SELECT key, value FROM bot_state
        WHERE key = 'queue_server_links' OR key = 'staff_queue_channel' OR key LIKE 'queue_message:%'`
    ),
    rows("SELECT id, data, created_at FROM web_lobbies WHERE created_at >= ? ORDER BY created_at DESC", [now - LIVE_WINDOW_MS]),
  ]);

  let nextServers: Record<string, string> = {};
  const posts: Record<string, string> = {};
  let lastChannelId: string | null = null;
  for (const row of state) {
    const key = String(row.key);
    const value = String(row.value ?? "");
    if (key === "queue_server_links") {
      try {
        nextServers = (JSON.parse(value || "{}") as Record<string, string>) ?? {};
      } catch {
        nextServers = {};
      }
    } else if (key === "staff_queue_channel") {
      lastChannelId = /^\d+$/.test(value) ? value : null;
    } else if (key.startsWith("queue_message:")) {
      const channel = value.split(":")[0];
      if (/^\d+$/.test(channel)) posts[key.slice("queue_message:".length).toUpperCase()] = channel;
    }
  }

  return {
    teamSize,
    regions: QUEUE_REGIONS.map((r) => {
      const open = gate.openRegions.includes(r.id);
      return {
        id: r.id,
        label: r.label,
        open,
        modes: open ? [...(gate.openModes[r.id] ?? [])] : [],
        waiting: waiting.byRegion[r.id] ?? 0,
        nextServer: nextServers[r.id] || null,
        postChannelId: open ? posts[r.id] ?? null : null,
      };
    }),
    liveMatches: lobbies
      .map((l) => liveMatch(String(l.id), String(l.data), Number(l.created_at)))
      .filter((m): m is StaffLiveMatch => m !== null),
    lastChannelId,
  };
}
