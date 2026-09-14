"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveMatchRoom, LiveLobby } from "@/components/live-match-room";
import { markMatchAccepted } from "@/components/match-ready-modal";
import { EmptyState } from "@/components/empty-state";
import { Swords } from "lucide-react";

export default function LiveMatchPage() {
  const [lobby, setLobby] = useState<LiveLobby | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const [lRes, sRes] = await Promise.all([fetch("/api/lobby"), fetch("/api/auth/me")]);
        const lData = await lRes.json();
        const sData = await sRes.json();
        setLobby((lData?.lobby as LiveLobby | null) ?? null);
        setSelfId(sData.user?.discordId ?? null);
        if (lData?.lobby?.channelId) markMatchAccepted(lData.lobby.channelId);
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
      <div className="max-w-3xl mx-auto px-4 py-16">
        <EmptyState
          icon={Swords}
          title="No live match"
          hint="When a 1v1 queue fills, this room opens with teams, map veto, and a Discord voice link."
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
