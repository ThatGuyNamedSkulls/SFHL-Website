import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLobbyForUser } from "@/lib/lobby";
import { listLobbyChat, postLobbyChat } from "@/lib/lobby-chat";
import { MAX_CHAT_FETCH, parseChatLimit } from "@/lib/chat-limits";

/** GET ?limit=<n> — latest match-room chat for the logged-in player's live
 *  lobby (the right-bar chat asks for the last 10). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ messages: [] });
  try {
    const lobby = await getLobbyForUser(session.discordId);
    if (!lobby) return NextResponse.json({ messages: [] });
    const limit = parseChatLimit(new URL(request.url).searchParams.get("limit"), MAX_CHAT_FETCH);
    const messages = await listLobbyChat(lobby.channelId, limit);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Error fetching lobby chat:", error);
    return NextResponse.json({ messages: [] });
  }
}

/** POST { content } — send a message from the website into Discord + the matchroom. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  let content = "";
  try {
    const body = await req.json();
    content = String(body?.content ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const lobby = await getLobbyForUser(session.discordId);
  if (!lobby) {
    return NextResponse.json({ error: "You're not in a live match." }, { status: 404 });
  }

  const result = await postLobbyChat({
    channelId: lobby.channelId,
    authorId: session.discordId,
    authorName: session.playerName || session.username,
    content,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const messages = await listLobbyChat(lobby.channelId);
  return NextResponse.json({ message: result, messages });
}
