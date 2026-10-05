"use client";

/** Report a player to staff from their profile — the same report /mod report makes in Discord. */
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KINDS = [
  "Team killing",
  "Trolling",
  "Ghosting",
  "Throwing",
  "Leaving mid game",
  "Toxic in chat",
  "Cheating",
  "Other",
];
const MAX = 400;

export function ReportDialog({
  player,
  open,
  onOpenChange,
  onSent,
}: {
  player: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (message: string) => void;
}) {
  const [kind, setKind] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = details.trim();
  const ready = kind && (kind !== "Other" || text.length >= 5);

  const send = async () => {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player, reason: text ? `${kind}: ${text}` : kind }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Couldn't send the report.");
        return;
      }
      setKind("");
      setDetails("");
      onOpenChange(false);
      onSent(`Report sent. Staff will look at it.`);
    } catch {
      setError("Couldn't send the report.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="border border-hl-border bg-hl-panel sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Report {player}</DialogTitle>
          <DialogDescription className="text-hl-muted">
            Staff see every report. Say what happened and in which match, so they can check it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  kind === k ? "border-transparent bg-gold-gradient text-hl-base" : "border-hl-border text-hl-muted hover:text-white"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, MAX))}
            rows={4}
            placeholder={kind === "Other" ? "What happened? (needed for Other)" : "What happened? Match number, round… (optional)"}
            className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.6875rem] text-hl-muted">
              {details.length}/{MAX}
            </span>
            <button
              type="button"
              disabled={!ready || sending}
              onClick={() => void send()}
              className="h-9 rounded-lg bg-[#ff5500] px-4 text-xs font-extrabold uppercase tracking-[0.06em] text-white hover:bg-[#ff6a1f] disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send report"}
            </button>
          </div>
          {error ? <p className="text-sm text-hl-red">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
