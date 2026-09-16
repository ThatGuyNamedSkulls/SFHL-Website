"use client";

import { useEffect, useState } from "react";
import { MapThumb } from "@/components/map-thumb";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { regionMeta } from "@/lib/format";
// Type-only: lib/subs.ts is server-side (it talks to the DB), so the shape
// lives in types/ and this component never imports the module itself.
import type { SubRequestView } from "@/types";
import { AlertCircle, Clock, Loader2, Swords, Timer, Users } from "lucide-react";

/** "2m 10s" from a second count, for the "open for" and countdown labels. */
function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/**
 * One open slot. The whole card is informational except the button: a viewer
 * who isn't eligible still sees the match (with the reason and, when the only
 * problem is the Elo band, a countdown to when it widens enough for them)
 * rather than having the card silently vanish.
 */
export function SubRequestCard({
  request,
  onJoin,
  joining,
}: {
  request: SubRequestView;
  onJoin: (id: number) => void;
  joining: boolean;
}) {
  // Local clock so "open for" and the eligibility countdown tick between the
  // 5s polls instead of jumping.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const openFor = (now - request.openedAt) / 1000;
  const countdown =
    request.eligibleInSeconds === null
      ? null
      : Math.max(0, request.eligibleInSeconds - (openFor - request.openSeconds));
  const region = request.region ? regionMeta(request.region) : null;

  return (
    <Card className="bg-hl-panel border-hl-border overflow-hidden">
      <div className="p-5 flex flex-wrap items-center gap-4">
        <MapThumb map={request.map} className="w-20 h-12" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white">{request.map}</span>
            <Badge className="bg-hl-panel-light text-hl-muted border-hl-border text-[10px]">
              {request.mode ?? "5v5"}
            </Badge>
            {region && (
              <Badge className="bg-hl-panel-light text-hl-muted border-hl-border text-[10px]">
                {region.flag} {region.label}
              </Badge>
            )}
          </div>

          <div className="text-sm text-hl-muted mt-1">
            Replacing <b className="text-white">{request.leaver}</b> on Team{" "}
            {request.team}
            {request.targetElo ? (
              <>
                {" "}
                · <span className="stat-number text-white">{request.targetElo}</span> Elo
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-4 mt-2 text-[11px] text-hl-muted flex-wrap">
            {request.swapScore && (
              <span className="inline-flex items-center gap-1">
                <Swords className="w-3.5 h-3.5" />
                Score on arrival{" "}
                <b className="text-white stat-number">
                  {request.swapScore.replace(",", " - ")}
                </b>
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Open for <b className="text-white">{duration(openFor)}</b>
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {request.band === null
                ? "Open to every Elo"
                : `Within ${request.band} Elo`}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 ml-auto">
          <button
            type="button"
            onClick={() => onJoin(request.id)}
            disabled={!request.eligible || joining}
            className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm header-caps transition-all ${
              request.eligible
                ? "find-match-btn text-hl-base"
                : "bg-hl-panel-light text-hl-muted cursor-not-allowed"
            } ${joining ? "opacity-60 cursor-wait" : ""}`}
          >
            {joining ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Joining…
              </>
            ) : (
              "Join now"
            )}
          </button>
          {countdown !== null && countdown > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-hl-gold">
              <Timer className="w-3.5 h-3.5" /> Eligible in {duration(countdown)}
            </span>
          )}
        </div>
      </div>

      {!request.eligible && request.reason && (
        <div className="px-5 py-3 border-t border-hl-border bg-hl-gold/5 text-hl-gold text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> {request.reason}
        </div>
      )}
    </Card>
  );
}
