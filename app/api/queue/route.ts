import { NextResponse } from "next/server";
import { getSession, isUserInGuildCached, getGuildPresenceCached } from "@/lib/auth";
import {
  getWebQueue,
  joinWebQueue,
  leaveWebQueueMany,
  getWebQueueSpot,
  getQueueTeamSize,
  getQueueGate,
  getPlayer,
} from "@/lib/db";
import { getPartyForMember } from "@/lib/parties";
import { clubTagIndex, lookupClubTag } from "@/lib/clubs";
import { getActiveLobbyMemberIds } from "@/lib/lobby";
import { upsertWebUser } from "@/lib/social";
import { isQueueRegion, regionMeta } from "@/lib/regions";
import { MATCH_TEAM_SIZE } from "@/lib/match-mode";
import {
  QUEUE_MODE_SUPER,
  SUPER_PARTY_MAX,
  SUPER_ELO_RANGE,
  eloRangeOk,
  parseQueueMode,
  queueModeLabel,
  QUEUE_MODE_PRO,
  PRO_QUEUE_ENABLED,
} from "@/lib/queue-modes";
import { PRO_KEEP_ELO, PRO_MIN_ELO, hasProAccess, proAccessByDiscordId } from "@/lib/pro";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function queueJson(data: unknown, init?: { status?: number }) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

/** GET — returns current web queue state. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const regionParam = (searchParams.get("region") || "").toUpperCase();
    const region = isQueueRegion(regionParam) ? regionParam : undefined;
    const session = await getSession();
    const [queue, teamSize, gate, me, tags, proEligible] = await Promise.all([
      getWebQueue(region),
      getQueueTeamSize(),
      getQueueGate(),
      session ? getWebQueueSpot(session.discordId) : Promise.resolve(null),
      clubTagIndex().catch(() => ({ byName: {}, byDiscord: {} })),
      session ? hasProAccess(session.discordId).catch(() => false) : Promise.resolve(false),
    ]);
    return queueJson({
      queue: queue.map((entry) => ({
        ...entry,
        clubTag: lookupClubTag(
          tags,
          entry.player_name,
          entry.discord_id != null ? String(entry.discord_id) : null
        ),
      })),
      count: queue.length,
      teamSize,
      open: gate.open,
      region: gate.region,
      openRegions: gate.openRegions,
      openModes: gate.openModes,
      me,
      // Pro Matchmaking is only shown to players who can join it (S2+).
      proEligible: PRO_QUEUE_ENABLED && proEligible,
    });
  } catch (error) {
    console.error("Error fetching queue:", error);
    return queueJson({
      queue: [],
      count: 0,
      teamSize: MATCH_TEAM_SIZE,
      open: false,
      region: null,
      openRegions: [],
      openModes: {},
      me: null,
      proEligible: false,
    });
  }
}

/** POST — join the queue (requires auth + guild membership + an open region queue) */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to join the queue" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({} as { region?: unknown; mode?: unknown }));
  const requested = typeof body.region === "string" ? body.region.toUpperCase() : "";
  const mode = parseQueueMode(body.mode);
  if (!isQueueRegion(requested)) {
    return NextResponse.json(
      { error: "Pick a region in Servers before finding a match." },
      { status: 400 }
    );
  }

  const gate = await getQueueGate();
  if (!gate.openRegions.length) {
    return NextResponse.json(
      { error: "No matchmaking queue is open. Wait for Match Staff to open a region queue in Discord." },
      { status: 403 }
    );
  }
  if (!gate.openRegions.includes(requested)) {
    const openLabels = gate.openRegions.map((code) => regionMeta(code).label).join(", ");
    return NextResponse.json(
      {
        error: `That region is closed. Open now: ${openLabels}. Switch in Servers to join.`,
      },
      { status: 403 }
    );
  }
  const regionModes = gate.openModes[requested] ?? ["standard", "super"];
  if (!regionModes.includes(mode)) {
    const label = queueModeLabel(mode);
    return NextResponse.json(
      { error: `${label} is closed in ${requested}. Wait for Match Staff to reopen that queue.` },
      { status: 403 }
    );
  }

  // Live guild + Bloxlink check — login-time flags go stale if they leave
  // Discord or haven't verified yet.
  const presence = await getGuildPresenceCached(session.discordId);
  const liveInGuild =
    presence !== null ? presence.inGuild : await isUserInGuildCached(session.discordId);
  if (liveInGuild === false || (!session.inGuild && liveInGuild !== true)) {
    return NextResponse.json(
      { error: "You must be a member of the HyperLeague Discord server to join the queue" },
      { status: 403 }
    );
  }
  if (presence && !presence.verified) {
    return NextResponse.json(
      { error: "You have to verify with Bloxlink in the HyperLeague Discord before you can queue." },
      { status: 403 }
    );
  }

  if (!session.playerName) {
    return NextResponse.json(
      { error: "Your Discord account is not linked to a HyperLeague player. Join the Discord server and verify with Bloxlink first." },
      { status: 403 }
    );
  }

  try {
    // Remember this player's Discord id so the bot can DM them by id.
    upsertWebUser(session.discordId, session.playerName, session.username).catch(() => {});

    const already = await getWebQueueSpot(session.discordId);
    if (already) {
      const where =
        already.mode === "standard" ? `${already.region} queue` : `${already.region} ${queueModeLabel(already.mode)}`;
      return NextResponse.json(
        {
          error:
            already.region === requested && already.mode === mode
              ? "You are already in the queue"
              : `You're already in the ${where}. Leave that one first.`,
        },
        { status: 409 }
      );
    }

    // If the user is in a party, queue the whole party together — only the
    // captain can start that. Matches Discord: `/setcaptain` / party leader.
    const party = await getPartyForMember(session.discordId);
    if (party && party.leaderId !== session.discordId) {
      return NextResponse.json(
        { error: "Only the party captain can start the queue." },
        { status: 403 }
      );
    }

    // Block re-queueing while a match is still live: a player already in a
    // match channel (their web_lobby row exists until that channel is deleted)
    // can't join a new queue. One member in a match blocks the whole party.
    const inMatch = await getActiveLobbyMemberIds();
    const toCheck = party ? party.members.map((m) => m.discordId) : [session.discordId];
    if (toCheck.some((id) => inMatch.has(id))) {
      const self = inMatch.has(session.discordId);
      return NextResponse.json(
        {
          error: self
            ? "You're already in a match. Finish it before queueing again."
            : "A party member is still in a match. Wait for it to finish before queueing.",
        },
        { status: 409 }
      );
    }

    // Every party member must meet the requirements (verified + linked) —
    // one unverified member blocks the whole party, FACEIT-style.
    if (party) {
      const blocked: string[] = [];
      for (const m of party.members) {
        if (!m.playerName) {
          blocked.push(m.username);
          continue;
        }
        const memberPresence = await getGuildPresenceCached(m.discordId);
        if (memberPresence === null) continue;
        if (!memberPresence.inGuild || !memberPresence.verified) {
          blocked.push(m.playerName || m.username);
        }
      }
      if (blocked.length > 0) {
        return NextResponse.json(
          {
            error: `Your party can't queue — these members don't meet the requirements: ${blocked.join(", ")}`,
          },
          { status: 403 }
        );
      }
    }

    if (mode === QUEUE_MODE_PRO && !PRO_QUEUE_ENABLED) {
      return NextResponse.json(
        {
          error:
            "Pro Matchmaking has moved to the League: league matches in Open10 and above give Pro ladder Elo. Sign your team up on the League tab.",
        },
        { status: 403 }
      );
    }
    if (mode === QUEUE_MODE_PRO) {
      const group = party?.members ?? [{ discordId: session.discordId, playerName: session.playerName, username: session.username }];
      const access = await proAccessByDiscordId(group.map((m) => String(m.discordId)));
      const blocked = group.filter((m) => !access.get(String(m.discordId)));
      if (blocked.length > 0) {
        return NextResponse.json(
          {
            error: `Pro Matchmaking is for S2+ players (${PRO_MIN_ELO}+ Elo; access is kept until you drop below ${PRO_KEEP_ELO}). Not eligible: ${blocked
              .map((m) => m.playerName || m.username)
              .join(", ")}`,
          },
          { status: 403 }
        );
      }
    }

    if (mode === QUEUE_MODE_SUPER) {
      const group = party?.members ?? [
        { playerName: session.playerName, username: session.username, elo: 0 },
      ];
      if (group.length > SUPER_PARTY_MAX) {
        return NextResponse.json(
          { error: "Super Match only allows solo, duo, or trio parties." },
          { status: 403 }
        );
      }
      const elos: number[] = [];
      const placing: string[] = [];
      for (const m of group) {
        const name = m.playerName;
        if (!name) continue;
        const row = await getPlayer(name);
        elos.push(Number(row?.elo ?? 0));
        if (!row || Number(row.placement_done) !== 1) {
          placing.push(m.playerName || m.username);
        }
      }
      if (placing.length > 0) {
        return NextResponse.json(
          {
            error:
              "Super Match is for ranked players. Everyone in the party must finish placements first.",
          },
          { status: 403 }
        );
      }
      if (!eloRangeOk(elos, SUPER_ELO_RANGE)) {
        return NextResponse.json(
          {
            error: `Super Match requires everyone in your party to be within ${SUPER_ELO_RANGE} Elo of each other.`,
          },
          { status: 403 }
        );
      }
    }

    const toQueue = party
      ? party.members
      : [
          {
            discordId: session.discordId,
            username: session.username,
            playerName: session.playerName,
          },
        ];
    for (const m of toQueue) {
      const other = await getWebQueueSpot(m.discordId);
      if (other && (other.region !== requested || other.mode !== mode)) {
        const where =
          other.mode === "standard" ? `${other.region} queue` : `${other.region} ${queueModeLabel(other.mode)}`;
        return NextResponse.json(
          {
            error: `${m.playerName || m.username} is already in the ${where}. Leave that one first.`,
          },
          { status: 409 }
        );
      }
      await joinWebQueue(m.discordId, m.username, m.playerName, requested, mode);
    }

    const queue = await getWebQueue(requested);
    return NextResponse.json({
      message: party ? "Party joined queue" : "Joined queue successfully",
      queue,
      count: queue.length,
    });
  } catch (error) {
    console.error("Error joining queue:", error);
    return NextResponse.json(
      { error: "Failed to join queue" },
      { status: 500 }
    );
  }
}

/** DELETE — leave the queue */
export async function DELETE(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in" },
      { status: 401 }
    );
  }

  try {
    // Leaving as part of a party pulls the whole party out of the queue, the
    // same way joining put them all in.
    const party = await getPartyForMember(session.discordId);
    const ids = [
      session.discordId,
      ...(party?.members?.map((m) => m.discordId) ?? []),
    ];
    await leaveWebQueueMany(ids);

    const { searchParams } = new URL(request.url);
    const regionParam = (searchParams.get("region") || "").toUpperCase();
    const region = isQueueRegion(regionParam) ? regionParam : undefined;
    const queue = await getWebQueue(region);
    return NextResponse.json({
      message: "Left queue",
      queue,
      count: queue.length,
    });
  } catch (error) {
    console.error("Error leaving queue:", error);
    return NextResponse.json(
      { error: "Failed to leave queue" },
      { status: 500 }
    );
  }
}
