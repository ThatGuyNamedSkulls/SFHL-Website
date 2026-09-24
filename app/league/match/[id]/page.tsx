"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ClubMark } from "@/components/club-identity";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { ArrowLeft, CalendarDays, Crown, Flag, ShieldCheck, Swords } from "lucide-react";

interface TeamView {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
  captainId: string | null;
  roster: { discordId: string; name: string }[];
}

interface MatchView {
  match: {
    id: number;
    week: number;
    stage: string;
    bo: number;
    status: string;
    proposedTime: number | null;
    proposedBy: string | null;
    scheduledAt: number | null;
    scoreA: number | null;
    scoreB: number | null;
    winner: string | null;
    reportedBy: string | null;
    reportedAt: number | null;
    resultKind: string | null;
    note: string | null;
    roomOpen: boolean;
    playoffRound?: string | null;
  };
  season: { id: number; name: string; status: string };
  window: { start: number; end: number; defaultSlot: number; fridayDeadline: number } | null;
  teamA: TeamView;
  teamB: TeamView;
  viewer: { captainOf: string | null; onRoster: string | null; staff?: boolean } | null;
  rules: { proposeMinLeadMs: number; forfeitClaimAfterMs: number; confirmWindowMs: number };
}

const STATUS: Record<string, { text: string; tone: string }> = {
  unscheduled: { text: "Needs a time", tone: "text-hl-muted" },
  proposed: { text: "Time proposed", tone: "text-hl-gold" },
  scheduled: { text: "Scheduled", tone: "text-[#7dd3fc]" },
  live: { text: "Live", tone: "text-[#ff4d4d]" },
  reported: { text: "Result waiting for confirmation", tone: "text-hl-gold" },
  disputed: { text: "Disputed — Match Staff decide", tone: "text-hl-red" },
  final: { text: "Final", tone: "text-hl-green" },
  forfeit: { text: "Final (forfeit)", tone: "text-hl-green" },
};

function fmt(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ms -> the value a datetime-local input wants, in the viewer's time zone. */
function toLocalInput(ms: number) {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function TeamHeader({ team, won, right }: { team: TeamView; won: boolean; right?: boolean }) {
  return (
    <Link
      href={`/teams/${team.id}`}
      className={`flex min-w-0 items-center gap-3 ${right ? "flex-row-reverse text-right" : ""}`}
    >
      <ClubMark tag={team.tag} accentColor={team.accentColor} logoUrl={team.logoUrl} size={48} />
      <div className="min-w-0">
        <div className={`truncate text-lg font-black ${won ? "text-hl-green" : "text-white"}`}>{team.name}</div>
        <div className="text-xs text-hl-muted">{team.tag ? `[${team.tag}]` : ""}</div>
      </div>
    </Link>
  );
}

export default function LeagueMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<MatchView | null>(null);
  const [missing, setMissing] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [reason, setReason] = useState("");
  const [concedeArmed, setConcedeArmed] = useState(false);
  const [now, setNow] = useState(0);
  // Match Staff panel.
  const [staffWinner, setStaffWinner] = useState<"a" | "b">("a");
  const [staffA, setStaffA] = useState("");
  const [staffB, setStaffB] = useState("");
  const [staffForfeit, setStaffForfeit] = useState(false);
  const [moveWhen, setMoveWhen] = useState("");

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    apiGetJson<MatchView>(`/api/league/matches/${id}`, { force: true })
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok && json) setData(json);
        else setMissing(true);
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/league/matches/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error || "Something went wrong.");
      else setData(json);
      invalidateClientApi();
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  if (missing && !data) {
    return (
      <div className="hl-page-wide py-16 text-center text-sm text-hl-muted">
        League match not found. <Link href="/league" className="text-hl-gold hover:underline">Back to the league</Link>
      </div>
    );
  }
  if (!data) return <div className="hl-page-wide py-16 text-center text-sm text-hl-muted">Loading…</div>;

  const { match, teamA, teamB, viewer, window: win, rules } = data;
  const status = STATUS[match.status] ?? { text: match.status, tone: "text-hl-muted" };
  const done = match.status === "final" || match.status === "forfeit";
  const myTeam = viewer?.captainOf ?? null;
  const theirTeam = myTeam === teamA.id ? teamB : myTeam === teamB.id ? teamA : null;
  const teamName = (tid: string | null) => (tid === teamA.id ? teamA.name : tid === teamB.id ? teamB.name : "");
  const canSchedule = !!myTeam && ["unscheduled", "proposed", "scheduled"].includes(match.status);
  const waitingOnMe = match.status === "proposed" && !!myTeam && match.proposedBy !== myTeam;
  const started = match.status === "live" || (match.scheduledAt !== null && now > 0 && match.scheduledAt <= now);
  const canReport = !!myTeam && ["scheduled", "live", "reported"].includes(match.status) && started;
  const toConfirm = match.status === "reported" && !!myTeam && match.reportedBy !== myTeam;
  const canClaim =
    !!myTeam &&
    ["scheduled", "live"].includes(match.status) &&
    match.scheduledAt !== null &&
    now >= match.scheduledAt + rules.forfeitClaimAfterMs;
  const whenMs = when ? new Date(when).getTime() : NaN;

  let middle = "vs";
  if (match.resultKind === "forfeit" && match.winner) middle = match.winner === teamA.id ? "W – FF" : "FF – W";
  else if (match.scoreA !== null && match.scoreB !== null) middle = `${match.scoreA} – ${match.scoreB}`;

  return (
    <div className="hl-page-wide space-y-5">
      <Link href="/league" className="inline-flex items-center gap-1 text-xs font-bold text-hl-muted hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> {data.season.name} · League
      </Link>

      <Card className="relative overflow-hidden border-hl-border bg-hl-panel p-5">
        <div className="absolute inset-0 bg-hero-radial opacity-50 pointer-events-none" />
        <div className="relative">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold header-caps text-hl-muted">
              Week {match.week} · BO{match.bo} ·{" "}
              {match.stage === "playoff"
                ? `Playoffs · ${
                    { semi1: "Semi-final", semi2: "Semi-final", final: "Final", third: "Third place" }[
                      match.playoffRound ?? ""
                    ] ?? ""
                  }`
                : "Regular season"}
            </span>
            <span className={`font-black header-caps ${status.tone}`}>{status.text}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
            <TeamHeader team={teamA} won={done && match.winner === teamA.id} />
            <div className="text-center">
              <div className={`text-2xl font-black tabular-nums ${done || match.status === "reported" ? "text-white" : "text-hl-muted"}`}>
                {middle}
              </div>
              {match.status === "reported" ? <div className="text-[10px] text-hl-gold">unconfirmed</div> : null}
            </div>
            <TeamHeader team={teamB} won={done && match.winner === teamB.id} right />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-hl-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {match.scheduledAt
                ? fmt(match.scheduledAt)
                : win
                  ? `No time yet — ${fmt(win.defaultSlot)} if nothing is agreed by ${fmt(win.fridayDeadline - 1)}`
                  : "Not scheduled"}
            </span>
            {match.roomOpen && viewer?.onRoster ? (
              <Link
                href="/match/live"
                className="find-match-btn inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-black header-caps text-hl-base"
              >
                <Swords className="h-3.5 w-3.5" /> Open match room
              </Link>
            ) : null}
          </div>
          {match.note && !done ? <p className="mt-2 text-xs text-hl-red">{match.note}</p> : null}
        </div>
      </Card>

      {error ? <p className="text-sm text-hl-red">{error}</p> : null}

      {myTeam ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {canSchedule ? (
            <Card className="border-hl-border bg-hl-panel p-4">
              <h2 className="mb-1 text-sm font-black header-caps text-white">Match time</h2>
              <p className="mb-3 text-xs text-hl-muted">
                Agree a time with {theirTeam?.name}. Times are shown in your time zone.
                {win ? ` Allowed: ${fmt(win.start)} – ${fmt(win.end)}.` : ""}
              </p>
              {match.status === "proposed" && match.proposedTime ? (
                <div className="mb-3 rounded-lg border border-hl-gold/30 bg-hl-gold/[0.06] px-3 py-2 text-sm text-white">
                  {teamName(match.proposedBy)} proposed <b>{fmt(match.proposedTime)}</b>
                  {waitingOnMe ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act("accept")}
                        className="find-match-btn h-8 rounded-lg px-3 text-xs font-black header-caps text-hl-base disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act("decline")}
                        className="h-8 rounded-lg border border-hl-border px-3 text-xs font-bold text-hl-muted hover:text-white disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-hl-muted">Waiting for the other captain.</div>
                  )}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={when}
                  min={win ? toLocalInput(win.start) : undefined}
                  max={win ? toLocalInput(win.end) : undefined}
                  onChange={(e) => setWhen(e.target.value)}
                  className="h-9 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white [color-scheme:dark]"
                />
                <button
                  type="button"
                  disabled={busy || !Number.isFinite(whenMs)}
                  onClick={() => act("propose", { time: whenMs })}
                  className="h-9 rounded-lg border border-hl-gold/50 px-3 text-xs font-black header-caps text-hl-gold hover:bg-hl-gold/10 disabled:opacity-40"
                >
                  {match.scheduledAt ? "Propose a new time" : "Propose time"}
                </button>
              </div>
            </Card>
          ) : null}

          {!done ? (
            <Card className="border-hl-border bg-hl-panel p-4">
              <h2 className="mb-1 text-sm font-black header-caps text-white">Result</h2>
              {toConfirm ? (
                <div className="mb-3 rounded-lg border border-hl-gold/30 bg-hl-gold/[0.06] px-3 py-2 text-sm text-white">
                  {match.resultKind === "forfeit"
                    ? `${teamName(match.reportedBy)} claimed a forfeit win (your team didn't show).`
                    : `${teamName(match.reportedBy)} reported ${teamA.name} ${match.scoreA} – ${match.scoreB} ${teamB.name}.`}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act("confirm")}
                      className="find-match-btn h-8 rounded-lg px-3 text-xs font-black header-caps text-hl-base disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value.slice(0, 200))}
                      placeholder="What's wrong? (for Match Staff)"
                      className="h-8 min-w-0 flex-1 rounded-lg border border-hl-border bg-hl-base px-2 text-xs text-white placeholder:text-hl-muted"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act("dispute", { reason })}
                      className="h-8 rounded-lg border border-hl-red/50 px-3 text-xs font-bold text-hl-red hover:bg-hl-red/10 disabled:opacity-50"
                    >
                      Dispute
                    </button>
                  </div>
                </div>
              ) : match.status === "reported" ? (
                <p className="mb-3 text-xs text-hl-muted">
                  You reported this result. Waiting for {theirTeam?.name} to confirm — unconfirmed results go to
                  Match Staff after 12 hours. You can still correct it below.
                </p>
              ) : match.status === "disputed" ? (
                <p className="mb-3 text-xs text-hl-muted">Match Staff will set the result.</p>
              ) : null}

              {canReport && !toConfirm ? (
                <div className="mb-3">
                  <p className="mb-2 text-xs text-hl-muted">
                    {match.bo > 1
                      ? `Maps won by each team — best of ${match.bo}, e.g. 2–0 or 2–1.`
                      : "Rounds won by each team (BO1)."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-white">
                      {teamA.tag || teamA.name}
                      <input
                        inputMode="numeric"
                        value={scoreA}
                        onChange={(e) => setScoreA(e.target.value.replace(/\D/g, "").slice(0, 2))}
                        className="h-9 w-14 rounded-lg border border-hl-border bg-hl-base px-2 text-center text-sm text-white"
                      />
                    </label>
                    <span className="text-hl-muted">–</span>
                    <label className="flex items-center gap-2 text-xs text-white">
                      <input
                        inputMode="numeric"
                        value={scoreB}
                        onChange={(e) => setScoreB(e.target.value.replace(/\D/g, "").slice(0, 2))}
                        className="h-9 w-14 rounded-lg border border-hl-border bg-hl-base px-2 text-center text-sm text-white"
                      />
                      {teamB.tag || teamB.name}
                    </label>
                    <button
                      type="button"
                      disabled={busy || scoreA === "" || scoreB === ""}
                      onClick={() => act("report", { scoreA: Number(scoreA), scoreB: Number(scoreB) })}
                      className="find-match-btn h-9 rounded-lg px-3 text-xs font-black header-caps text-hl-base disabled:opacity-40"
                    >
                      Report
                    </button>
                  </div>
                </div>
              ) : !started && !toConfirm && match.status !== "disputed" ? (
                <p className="mb-3 text-xs text-hl-muted">You can report the score once the match has started.</p>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-hl-border/60 pt-3">
                <button
                  type="button"
                  disabled={busy || !canClaim}
                  title={`Available ${Math.round(rules.forfeitClaimAfterMs / 60_000)} minutes after the start`}
                  onClick={() => act("claimForfeit")}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-hl-border px-3 text-xs font-bold text-hl-muted hover:text-white disabled:opacity-40"
                >
                  <Flag className="h-3.5 w-3.5" /> Other team didn&apos;t show
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (concedeArmed ? act("concede") : setConcedeArmed(true))}
                  className="h-8 rounded-lg border border-hl-border px-3 text-xs font-bold text-hl-muted hover:text-hl-red disabled:opacity-40"
                >
                  {concedeArmed ? "Click again to forfeit the match" : "Forfeit our match"}
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {viewer?.staff ? (
        <Card className="border-hl-gold/40 bg-hl-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-hl-gold" />
            <h2 className="text-sm font-black header-caps text-white">Match Staff</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-bold text-white">
                {done ? "Override the result" : "Set the result"}
                {match.status === "disputed" && match.note ? (
                  <span className="ml-1 font-normal text-hl-red">— {match.note}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={staffWinner}
                  onChange={(e) => setStaffWinner(e.target.value as "a" | "b")}
                  className="h-9 rounded-lg border border-hl-border bg-hl-base px-2 text-sm text-white"
                >
                  <option value="a">{teamA.name} won</option>
                  <option value="b">{teamB.name} won</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs text-hl-muted">
                  <input type="checkbox" checked={staffForfeit} onChange={(e) => setStaffForfeit(e.target.checked)} />
                  by forfeit
                </label>
                {!staffForfeit ? (
                  <>
                    <input
                      inputMode="numeric"
                      placeholder={teamA.tag || "A"}
                      value={staffA}
                      onChange={(e) => setStaffA(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      className="h-9 w-14 rounded-lg border border-hl-border bg-hl-base px-2 text-center text-sm text-white placeholder:text-hl-muted"
                    />
                    <span className="text-hl-muted">–</span>
                    <input
                      inputMode="numeric"
                      placeholder={teamB.tag || "B"}
                      value={staffB}
                      onChange={(e) => setStaffB(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      className="h-9 w-14 rounded-lg border border-hl-border bg-hl-base px-2 text-center text-sm text-white placeholder:text-hl-muted"
                    />
                  </>
                ) : null}
                <button
                  type="button"
                  disabled={busy || (!staffForfeit && (staffA === "" || staffB === ""))}
                  onClick={() =>
                    act("staffSetResult", {
                      winner: staffWinner === "a" ? teamA.id : teamB.id,
                      forfeit: staffForfeit,
                      scoreA: staffForfeit ? null : Number(staffA),
                      scoreB: staffForfeit ? null : Number(staffB),
                    })
                  }
                  className="find-match-btn h-9 rounded-lg px-3 text-xs font-black header-caps text-hl-base disabled:opacity-40"
                >
                  Save result
                </button>
              </div>
            </div>
            {["unscheduled", "proposed", "scheduled"].includes(match.status) ? (
              <div>
                <div className="mb-2 text-xs font-bold text-white">Move the match (any time, your time zone)</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={moveWhen}
                    onChange={(e) => setMoveWhen(e.target.value)}
                    className="h-9 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white [color-scheme:dark]"
                  />
                  <button
                    type="button"
                    disabled={busy || !moveWhen}
                    onClick={() => act("staffReschedule", { time: new Date(moveWhen).getTime() })}
                    className="h-9 rounded-lg border border-hl-gold/50 px-3 text-xs font-black header-caps text-hl-gold hover:bg-hl-gold/10 disabled:opacity-40"
                  >
                    Move match
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-hl-muted">Both rosters get a DM with the new time.</p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        {[teamA, teamB].map((t) => (
          <Card key={t.id} className="border-hl-border bg-hl-panel p-4">
            <h2 className="mb-3 text-sm font-black header-caps text-white">{t.name} roster</h2>
            <div className="space-y-1">
              {t.roster.map((p) => (
                <div key={p.discordId} className="flex items-center gap-2 rounded-lg bg-hl-base/50 px-3 py-1.5 text-sm text-white">
                  {p.discordId === t.captainId ? <Crown className="h-3.5 w-3.5 text-hl-gold" /> : null}
                  {p.name}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
