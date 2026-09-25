"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, X } from "lucide-react";
import { LiveLobby } from "@/components/live-match-room";
import { markMatchAccepted } from "@/components/match-ready-modal";
import { formatScoreDisplay } from "@/lib/format";
import { SWING_GREAT } from "@/lib/match-stats";
import { SubRolePill } from "@/components/sub-role-pill";
import { useSession } from "@/components/session-provider";
import { apiGetJson } from "@/lib/client-api";
import { usePolling } from "@/components/use-polling";
import { STATUS_TTL_MS } from "@/components/status-poller";

interface RecentMatch {
  id: number;
  matchId: number | null;
  date: string;
  map: string;
  result: "W" | "L";
  rounds: string;
  mode: string;
  swing?: number;
  isSub?: boolean;
  leftEarly?: boolean;
  subShare?: number | null;
}

const WASH_WIN = "#2ecc71";
const WASH_LOSS = "#e74c3c";
const WASH_GOLD = "#ffc44d";

function resultWash(match: RecentMatch): string {
  if (match.result !== "W") return WASH_LOSS;
  if ((match.swing ?? 0) >= SWING_GREAT) return WASH_GOLD;
  return WASH_WIN;
}

function formatPastWhen(date: string): string {
  const raw = date.trim();
  if (!raw) return "";
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / 86400000);
  if (diffDays === 0) return `TODAY, ${time}`;
  if (diffDays === 1) return `YESTERDAY, ${time}`;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
  return `${day}, ${time}`;
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function parseJoinedAt(raw: string): number {
  const iso = raw.includes("T") || /Z|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
}

function PastMatchCard({ match }: { match: RecentMatch }) {
  const win = match.result === "W";
  const gold = win && (match.swing ?? 0) >= SWING_GREAT;
  const href = match.matchId ? `/match/${match.matchId}` : "#";
  const wash = resultWash(match);
  const title = match.matchId ? `match_${match.matchId}` : `match_${match.id}`;

  return (
    <Link href={href} className="relative overflow-hidden rounded-lg bg-[#1c1c1c] block h-[88px]">
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: gold ? WASH_GOLD : win ? WASH_WIN : WASH_LOSS }}
      />
      <span
        className="absolute inset-y-0 right-0 w-[46%] pointer-events-none"
        style={{ background: `linear-gradient(90deg, #1c1c1c 0%, ${wash}55 55%, ${wash}88 100%)` }}
      />
      <span className="absolute inset-y-0 right-0 w-[46%] bg-gradient-to-l from-black/25 to-[#1c1c1c] pointer-events-none" />
      <div className="relative h-full flex flex-col justify-center pl-3.5 pr-4 py-2">
        <div className="text-[10px] font-semibold tracking-wide text-[#8a8a8a] uppercase">
          {formatPastWhen(match.date)}
        </div>
        <div className="text-sm font-bold text-white truncate">{title}</div>
        <div className="text-[11px] text-[#8a8a8a]">
          {match.map} · {match.mode}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className={`inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded text-[10px] font-black ${
              gold
                ? "bg-[#ffc44d] text-[#1a1400]"
                : win
                  ? "bg-[#2ecc71] text-[#0b1a10]"
                  : "bg-[#e74c3c] text-white"
            }`}
          >
            {match.result}
          </span>
          {match.rounds ? (
            <span className="text-[12px] font-bold tabular-nums text-white">
              {formatScoreDisplay(match.rounds)}
            </span>
          ) : null}
          <SubRolePill isSub={match.isSub} leftEarly={match.leftEarly} share={match.subShare} compact />
        </div>
      </div>
    </Link>
  );
}

/** FACEIT-style VS Matches drawer. */
export function VsMatchesPanel() {
  const router = useRouter();
  const { session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [lobby, setLobby] = useState<LiveLobby | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [matches, setMatches] = useState<RecentMatch[]>([]);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    try {
      const cached = open ? undefined : { ttlMs: STATUS_TTL_MS };
      const [l, m, q] = await Promise.all([
        apiGetJson<{ lobby?: LiveLobby | null }>("/api/lobby", cached),
        apiGetJson<{ matches?: RecentMatch[] }>("/api/matches/recent", cached),
        apiGetJson<{ queue?: { discord_id: string; joined_at: string }[] }>("/api/queue", cached),
      ]);
      const user = session;
      setLobby((l.json?.lobby as LiveLobby | null) ?? null);
      setLoggedIn(!!user);
      setMatches(Array.isArray(m.json?.matches) ? m.json.matches : []);
      const mine = user
        ? (q.json?.queue as { discord_id: string; joined_at: string }[] | undefined)?.find(
            (entry) => entry.discord_id === user.discordId
          )
        : null;
      setQueuedAt(mine?.joined_at ? parseJoinedAt(mine.joined_at) : null);
    } catch {
      /* ignore */
    }
  }, [session?.discordId, open]);

  usePolling(load, open ? 3000 : 20_000, { restartKey: open ? 1 : 0 });

  useEffect(() => {
    if (!open || !queuedAt || lobby) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [open, queuedAt, lobby]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const inMatch = !!lobby;
  const searching = !inMatch && queuedAt != null;
  const past = matches.slice(0, inMatch ? 6 : 8);
  const active = inMatch || searching || open;
    const icon =
    "flex items-center justify-center w-11 h-11 rounded-md text-[#8b8b8b] hover:text-white hover:bg-white/5 transition-colors";

  const goMatchroom = () => {
    if (lobby) markMatchAccepted(lobby.channelId);
    setOpen(false);
    router.push("/match/live");
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        title="Matches"
        onClick={() => setOpen((v) => !v)}
        className={`${icon} ${active ? "text-[#ff5500]" : ""}`}
      >
        <span className="text-[10px] font-black tracking-widest leading-none">VS</span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[80] top-2 bottom-2 right-[calc(var(--hl-sidebar-w)+8px)] w-[340px] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#161616] shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 shrink-0">
              <span className="text-lg font-bold text-white">Matches</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-[#8a8a8a] hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!loggedIn ? (
              <div className="p-4 text-sm text-[#8a8a8a]">
                <Link href="/login" className="text-[#ff5500] font-bold hover:underline">
                  Log in
                </Link>{" "}
                to see your matches.
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-3">
                {inMatch && (
                  <button
                    type="button"
                    onClick={goMatchroom}
                    className="w-full rounded-lg border border-[#ff5500] px-3 py-2.5 text-left hover:bg-[#ff5500]/10"
                  >
                    <div className="text-sm font-semibold text-white">Ongoing match</div>
                    <div className="text-sm font-semibold text-[#ff5500]">Go to matchroom</div>
                  </button>
                )}

                {searching && queuedAt && (
                  <div className="flex items-center justify-between rounded-lg border border-[#3b9eff] px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-white">Finding match</div>
                      <div className="text-sm tabular-nums text-white">{formatElapsed(now - queuedAt)}</div>
                    </div>
                    <Clock className="w-5 h-5 text-[#8a8a8a]" />
                  </div>
                )}

                <div>
                  <div className="text-[12px] text-[#8a8a8a] mb-2">Past</div>
                  {past.length === 0 ? (
                    <p className="text-sm text-[#8a8a8a] py-6 text-center">No matches recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {past.map((m) => (
                        <PastMatchCard key={m.id} match={m} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
