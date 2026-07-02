import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWebQueue, joinWebQueue, leaveWebQueue, isInWebQueue } from "@/lib/db";
import { getPartyForMember } from "@/lib/parties";

/** GET — returns current web queue state */
export async function GET() {
  try {
    const queue = await getWebQueue();
    return NextResponse.json({ queue, count: queue.length });
  } catch (error) {
    console.error("Error fetching queue:", error);
    return NextResponse.json({ queue: [], count: 0 });
  }
}

/** POST — join the queue (requires auth + guild membership) */
export async function POST() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to join the queue" },
      { status: 401 }
    );
  }

  if (!session.inGuild) {
    return NextResponse.json(
      { error: "You must be a member of the SFHL Discord server to join the queue" },
      { status: 403 }
    );
  }

  if (!session.playerName) {
    return NextResponse.json(
      { error: "Your Discord account is not linked to an SFHL player. Contact an admin." },
      { status: 403 }
    );
  }

  try {
    if (await isInWebQueue(session.discordId)) {
      return NextResponse.json(
        { error: "You are already in the queue" },
        { status: 409 }
      );
    }

    // If the user is in a party, queue the whole party together — otherwise
    // only the person who clicked would join. Matches the Discord behaviour
    // where any party member joining queues everyone.
    const party = await getPartyForMember(session.discordId);
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
      await joinWebQueue(m.discordId, m.username, m.playerName);
    }

    const queue = await getWebQueue();
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
export async function DELETE() {
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

    const queue = await getWebQueue();
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
