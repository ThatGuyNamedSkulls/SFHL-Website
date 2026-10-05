"use client";

/**
 * The overtime tie vote in the website match room — the same vote as the
 * Discord one (lib/overtime-votes.ts). The match's players vote "tie" here or
 * on Discord; once enough have, the match is a draw and staff rank it.
 */
import { useState } from "react";
import { Scale } from "lucide-react";
import type { OvertimeVoteView } from "@/lib/overtime-votes";

export function OvertimeVoteCard({
  vote,
  now,
  onVoted,
}: {
  vote: OvertimeVoteView;
  now: number;
  onVoted: (vote: OvertimeVoteView) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = vote.status === "open";
  const secondsLeft = Math.max(0, Math.ceil((vote.endsAt - now) / 1000));
  const pct = vote.required ? Math.min(100, Math.round((vote.yes / vote.required) * 100)) : 0;

  const cast = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/lobby/overtime-vote", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { vote?: OvertimeVoteView; error?: string };
      if (!res.ok || !json.vote) setError(json.error || "Couldn't count your vote.");
      else onVoted(json.vote);
    } catch {
      setError("Couldn't count your vote.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`rounded-lg border p-3 ${
        open ? "border-hl-gold/50 bg-hl-gold/5" : vote.status === "tie" ? "border-hl-green/40 bg-hl-green/5" : "border-hl-border"
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-black header-caps text-white">
        <Scale className="h-3.5 w-3.5 text-hl-gold" />
        Overtime {vote.overtime} · tie vote
      </div>
      {open ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-hl-gold transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[0.75rem] text-[#c8c8c8]">
            <span>
              {vote.yes} of {vote.required} tie votes needed
            </span>
            <span className="text-hl-muted">{secondsLeft}s</span>
          </div>
          {vote.voted ? (
            <p className="mt-2 text-[0.75rem] text-hl-green">You voted for a tie.</p>
          ) : vote.canVote ? (
            <button
              type="button"
              disabled={sending || secondsLeft === 0}
              onClick={() => void cast()}
              className="mt-2 h-8 w-full rounded-md bg-hl-gold/90 text-xs font-black text-hl-base hover:bg-hl-gold disabled:opacity-50"
            >
              {sending ? "Voting…" : "Vote tie"}
            </button>
          ) : (
            <p className="mt-2 text-[0.75rem] text-hl-muted">Only this match&apos;s players vote.</p>
          )}
          {error ? <p className="mt-1.5 text-[0.75rem] text-hl-red">{error}</p> : null}
        </>
      ) : vote.status === "tie" ? (
        <p className="mt-1.5 text-[0.8125rem] text-hl-green">
          Tie: {vote.yes} players voted for a draw. Staff will rank the match as a draw.
        </p>
      ) : (
        <p className="mt-1.5 text-[0.8125rem] text-[#c8c8c8]">
          No tie ({vote.yes} of {vote.required} votes). The match plays on.
        </p>
      )}
    </div>
  );
}
