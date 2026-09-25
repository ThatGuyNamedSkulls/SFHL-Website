"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SubRequestCard } from "@/components/sub-request-card";
import type { SubRequestView } from "@/types";
import { AlertCircle, Clock, UserPlus, Zap } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { apiGetJson } from "@/lib/client-api";
import { startPolling } from "@/lib/poll-gate";

/** How a sub's Elo works, so nobody claims a slot without knowing the deal. */
const RULES = [
  "You earn Elo for the rounds you actually play — a full share on a win.",
  "A loss costs you less than it costs the player who left: you inherited their deficit.",
  "Join with almost nothing left to play and it's stats only, no Elo either way.",
];

export default function SubsPage() {
  const router = useRouter();
  const { session } = useSession();
  const [requests, setRequests] = useState<SubRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<number | null>(null);
  const [claimed, setClaimed] = useState<SubRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ignore a poll that was already in flight when the user hit Join, so it
  // can't repaint the list over the claim's result.
  const claimInFlight = useRef(false);

  const poll = useCallback(async () => {
    try {
      const { json } = await apiGetJson<{ requests?: SubRequestView[] }>("/api/subs");
      if (!claimInFlight.current) {
        setRequests((json.requests as SubRequestView[]) ?? []);
      }
    } catch {
      /* transient — the next poll will catch up */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (claimed) return;  // claimed: the matchroom watcher below takes over
    return startPolling(poll, 5000);
  }, [poll, claimed]);

  // After claiming, the bot still has to grant Discord access and add the
  // player to the lobby roster (a few seconds). Wait for the matchroom to
  // actually exist before sending them there, instead of landing them on a
  // "no live match" screen.
  useEffect(() => {
    if (!claimed) return;
    let cancelled = false;
    const watch = async () => {
      try {
        const res = await fetch("/api/lobby");
        const data = await res.json();
        if (!cancelled && data?.lobby) router.push("/match/live");
      } catch {
        /* keep waiting */
      }
    };
    watch();
    const id = setInterval(watch, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [claimed, router]);

  const handleJoin = async (id: number) => {
    setJoiningId(id);
    claimInFlight.current = true;
    setError(null);
    try {
      const res = await fetch("/api/subs/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to join that match");
        await poll();
        return;
      }
      setClaimed((data.request as SubRequestView) ?? null);
    } catch {
      setError("Something went wrong joining that match");
    } finally {
      setJoiningId(null);
      claimInFlight.current = false;
    }
  };

  return (
    <div className="hl-page">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-hl-gold/10 border border-hl-gold/30 flex items-center justify-center">
          <UserPlus className="w-5 h-5 text-hl-gold" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-white header-caps">Join as a substitute</h1>
          <p className="text-sm text-hl-muted">
            Live matches whose player left. Take their slot, play it out, keep the Elo.
          </p>
        </div>
        <Badge className="ml-auto bg-hl-gold/10 text-hl-gold border-hl-gold/30">
          {requests.length} open
        </Badge>
      </div>

      {error && (
        <div className="mb-5 p-4 rounded-xl bg-hl-red/10 border border-hl-red/20 text-hl-red flex items-center gap-2 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {claimed ? (
        <Card className="bg-hl-panel border-hl-green/40 p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-hl-green/10 border border-hl-green/30 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-hl-green/40 border-t-hl-green animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-black text-white">
                You&apos;re in — subbing for {claimed.leaver} on Team {claimed.team}
              </div>
              <div className="text-sm text-hl-muted mt-0.5">
                Getting you access to the match channels. Your matchroom opens
                automatically in a moment.
              </div>
            </div>
            {claimed.channelUrl && (
              <a
                href={claimed.channelUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-hl-panel-light text-white border border-hl-border hover:border-hl-gold/40 transition-colors font-black text-sm header-caps"
              >
                Open in Discord
              </a>
            )}
          </div>
        </Card>
      ) : loading ? (
        <Card className="bg-hl-panel border-hl-border">
          <div className="flex items-center justify-center py-16">
            <div className="w-10 h-10 rounded-full border-2 border-hl-border border-t-hl-gold animate-spin" />
          </div>
        </Card>
      ) : requests.length === 0 ? (
        <Card className="bg-hl-panel border-hl-border">
          <EmptyState
            icon={Clock}
            title="No matches need a sub right now"
            hint="Slots open when a player leaves a live match. They fill fast, so check back — or join the queue for a full match instead."
          >
            <Link
              href="/queue"
              className="find-match-btn inline-flex items-center gap-2 px-6 py-3 rounded-xl text-hl-base font-black text-sm header-caps"
            >
              <Zap className="w-4 h-4" /> Find a match
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <SubRequestCard
              key={request.id}
              request={request}
              onJoin={handleJoin}
              joining={joiningId === request.id}
            />
          ))}
        </div>
      )}

      {!session && !loading && (
        <div className="mt-5 p-4 rounded-xl bg-hl-gold/10 border border-hl-gold/30 text-hl-gold flex items-center gap-2 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>
            <Link href="/login" className="underline font-bold">
              Log in
            </Link>{" "}
            to claim a slot.
          </span>
        </div>
      )}

      <Card className="bg-hl-panel border-hl-border p-5 mt-6">
        <h2 className="text-sm font-bold text-white header-caps mb-3">How sub Elo works</h2>
        <ul className="space-y-2">
          {RULES.map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-sm text-hl-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-hl-gold mt-1.5 shrink-0" />
              {rule}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
