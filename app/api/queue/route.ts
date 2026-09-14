import { NextResponse } from "next/server";
import { getSession, isUserInGuildCached } from "@/lib/auth";
import { getWebQueue, joinWebQueue, leaveWebQueue, getWebQueueRegion, getQueueTeamSize, getQueueGate } from "@/lib/db";
import { getPartyForMember } from "@/lib/parties";
import { getActiveLobbyMemberIds } from "@/lib/lobby";
import { upsertWebUser } from "@/lib/social";
import { isPlayRegion, regionMeta } from "@/lib/regions";
import { MATCH_TEAM_SIZE } from "@/lib/match-mode";

/** GET — returns current web queue state (1v1 while testing). */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const regionParam = (searchParams.get("region") || "").toUpperCase();
    const region = isPlayRegion(regionParam) ? regionParam : undefined;
    const [queue, teamSize, gate] = await Promise.all([
      getWebQueue(region),
      getQueueTeamSize(),
      getQueueGate(),
    ]);
    return NextResponse.json({
      queue,
      count: queue.length,
      teamSize,
      open: gate.open,
      region: gate.region,
      openRegions: gate.openRegions,
    });
  } catch (error) {
    console.error("Error fetching queue:", error);
    return NextResponse.json({
      queue: [],
      count: 0,
      teamSize: MATCH_TEAM_SIZE,
      open: false,
      region: null,
      openRegions: [],
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

  const body = await request.json().catch(() => ({} as { region?: unknown }));
  const requested = typeof body.region === "string" ? body.region.toUpperCase() : "";
  if (!isPlayRegion(requested)) {
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

  // Verified = currently in the guild. Re-check live (cached) rather than
  // trusting the login-time session flag — someone who left the server since
  // logging in must not be able to queue.
  const liveInGuild = await isUserInGuildCached(session.discordId);
  if (liveInGuild === false || (!session.inGuild && liveInGuild !== true)) {
    return NextResponse.json(
      { error: "You must be a member of the HyperLeague Discord server to join the queue" },
      { status: 403 }
    );
  }

  if (!session.playerName) {
    return NextResponse.json(
      { error: "Your Discord account is not linked to a HyperLeague player. Contact an admin." },
      { status: 403 }
    );
  }

  try {
    // Remember this player's Discord id so the bot can DM them by id.
    upsertWebUser(session.discordId, session.playerName, session.username).catch(() => {});

    const alreadyRegion = await getWebQueueRegion(session.discordId);
    if (alreadyRegion) {
      return NextResponse.json(
        {
          error:
            alreadyRegion === requested
              ? "You are already in the queue"
              : `You're already in the ${alreadyRegion} queue. Leave that one first.`,
        },
        { status: 409 }
      );
    }

    // If the user is in a party, queue the whole party together — otherwise
    // only the person who clicked would join. Matches the Discord behaviour
    // where any party member joining queues everyone.
    const party = await getPartyForMember(session.discordId);

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
        const verified = await isUserInGuildCached(m.discordId);
        if (verified === false) blocked.push(m.playerName || m.username);
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
      const other = await getWebQueueRegion(m.discordId);
      if (other && other !== requested) {
        return NextResponse.json(
          {
            error: `${m.playerName || m.username} is already in the ${other} queue. Leave that one first.`,
          },
          { status: 409 }
        );
      }
      await joinWebQueue(m.discordId, m.username, m.playerName, requested);
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
    if (party) {
      for (const m of party.members) {
        await leaveWebQueue(m.discordId);
      }
    } else {
      await leaveWebQueue(session.discordId);
    }

    const { searchParams } = new URL(request.url);
    const regionParam = (searchParams.get("region") || "").toUpperCase();
    const region = isPlayRegion(regionParam) ? regionParam : undefined;
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
