"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveMatchRoom, LiveLobby } from "@/components/live-match-room";
import { markMatchAccepted } from "@/components/match-ready-modal";
import { EmptyState } from "@/components/empty-state";
import { Swords } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { apiGetJson } from "@/lib/client-api";

export default function LiveMatchPage() {
  const { session } = useSession();
  const [lobby, setLobby] = useState<LiveLobby | null>(null);
  const [loaded, setLoaded] = useState(false);
  const selfId = session?.discordId ?? null;

  useEffect(() => {
    const poll = async () => {
      try {
        const { json } = await apiGetJson<{ lobby?: LiveLobby | null }>("/api/lobby");
        setLobby((json?.lobby as LiveLobby | null) ?? null);
        if (json?.lobby?.channelId) markMatchAccepted(json.lobby.channelId);
      } catch {
        /* ignore */
      } finally {
        setLoaded(true);
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-10 h-10 rounded-full border-2 border-hl-border border-t-hl-gold animate-spin" />
      </div>
    );
  }

  if (!lobby) {
    return (
      <div className="hl-page py-16">
        <EmptyState
          icon={Swords}
          title="No live match"
          hint="When a 5v5 queue fills, this room opens with teams, map veto, and a Discord voice link."
        />
        <div className="mt-4 text-center">
          <Link href="/queue" className="inline-flex px-5 py-2.5 rounded-lg bg-gold-gradient text-hl-base font-bold text-sm">
            Go to Play
          </Link>
        </div>
      </div>
    );
  }

  return <LiveMatchRoom lobby={lobby} selfId={selfId} onLobby={setLobby} />;
}
