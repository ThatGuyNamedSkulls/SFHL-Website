import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWebQueue, joinWebQueue, leaveWebQueue, isInWebQueue } from "@/lib/db";

/** GET — returns current web queue state */
export async function GET() {
  try {
    const queue = getWebQueue();
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
    if (isInWebQueue(session.discordId)) {
      return NextResponse.json(
        { error: "You are already in the queue" },
        { status: 409 }
      );
    }

    joinWebQueue(session.discordId, session.username, session.playerName);
    const queue = getWebQueue();
    return NextResponse.json({
      message: "Joined queue successfully",
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
    leaveWebQueue(session.discordId);
    const queue = getWebQueue();
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
