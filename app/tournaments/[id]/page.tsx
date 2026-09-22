"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { BracketView } from "@/components/bracket-view";
import { PlayerSearch } from "@/components/player-search";
import { useSession } from "@/components/session-provider";
import { matchesToView, roundLabel } from "@/lib/tournament-bracket";
import { regionMeta } from "@/lib/regions";
import type { BracketMatch, Tournament } from "@/lib/tournament-types";

interface Viewer {
  organizer: boolean;
  staff: boolean;
  captainOf: string | null;
  inviteTeamId: string | null;
  pendingRequest: boolean;
  clubMember: boolean;
}

type ScoreRow = { map: string; scoreA: string; scoreB: string };

const field =
  "h-10 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white focus:outline-none focus:border-hl-gold/50";

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session, refresh } = useSession();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [clubName, setClubName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [captainName, setCaptainName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ScoreRow[]>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/tournaments/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setTournament(data.tournament ?? null);
    setViewer(data.viewer ?? null);
    setClubName(data.clubName ?? null);
  }, [id]);

  useEffect(() => {
    load().catch(() => setMissing(true));
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/tournaments/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed");
        return;
      }
      setTournament(data.tournament ?? null);
      setViewer(data.viewer ?? null);
      await refresh({ force: true });
    } finally {
      setBusy(false);
    }
  };

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of tournament?.teams ?? []) map.set(team.id, team.name);
    return map;
  }, [tournament]);

  if (missing) {
    return <div className="hl-page text-sm text-hl-muted">Cup not found.</div>;
  }
  if (!tournament || !viewer) {
    return <div className="hl-page text-sm text-hl-muted">Loading cup…</div>;
  }

  const open = tournament.status === "open";
  const onRoster = tournament.teams.some((team) =>
    team.members.some((m) => m.discordId === session?.discordId && m.status === "accepted")
  );
  const elim = tournament.bracket === "double" ? "Double elimination" : "Single elimination";
  const winners = matchesToView(tournament.matches, names, "winners", tournament.size, tournament.id);
  const losers = matchesToView(tournament.matches, names, "losers", tournament.size, tournament.id);
  const grand = matchesToView(tournament.matches, names, "grand", tournament.size, tournament.id);
  const ready = tournament.matches.filter((m) => m.status === "ready");
  const canReport = (match: BracketMatch) =>
    viewer.organizer ||
    tournament.teams.some(
      (team) =>
        viewer.captainOf === team.id && (team.id === match.teamAId || team.id === match.teamBId)
    );
  const reportable = ready.filter(canReport);

  const blankScores = (): ScoreRow[] =>
    Array.from({ length: tournament.bo === 1 ? 1 : 2 }, () => ({
      map: tournament.mapPool[0] || "",
      scoreA: "",
      scoreB: "",
    }));

  const showRequest =
    open &&
    !!session &&
    !onRoster &&
    !viewer.pendingRequest &&
    !viewer.inviteTeamId &&
    (tournament.kind === "official" || viewer.clubMember);
  const showPrivateBlock =
    open &&
    tournament.kind === "community" &&
    !viewer.clubMember &&
    !onRoster &&
    !viewer.pendingRequest &&
    !viewer.inviteTeamId;
  const reviewer = tournament.kind === "official" ? "Match Staff" : "the club owner";
  const pendingRequests = tournament.requests.filter((r) => r.status === "pending");
  const statusPill =
    tournament.status === "live"
      ? "bg-hl-red/15 text-hl-red border-hl-red/40"
      : tournament.status === "open"
        ? "bg-hl-teal/15 text-hl-teal border-hl-teal/40"
        : "bg-hl-base text-hl-muted border-hl-border";

  return (
    <div className="hl-page">
      <Link href="/tournaments" className="text-xs font-bold text-hl-gold hover:underline">
        ← All tournaments
      </Link>
      <Card className="mt-3 mb-6 bg-hl-panel border-hl-border overflow-hidden p-0">
        <div
          className={`h-1 ${
            tournament.status === "live" ? "bg-hl-red" : tournament.status === "open" ? "bg-hl-teal" : "bg-hl-muted/40"
          }`}
        />
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPill}`}>
                  {tournament.status}
                </span>
                <span className="rounded-full border border-hl-border bg-hl-base px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hl-muted">
                  {tournament.kind === "official" ? "Official" : "Club cup"}
                </span>
                {tournament.clubId && clubName ? (
                  <Link
                    href={`/clubs/${tournament.clubId}`}
                    className="rounded-full border border-hl-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hl-gold hover:border-hl-gold/40"
                  >
                    {clubName}
                  </Link>
                ) : null}
              </div>
              <h1 className="text-2xl font-black text-white">{tournament.name}</h1>
              <p className="mt-1 text-sm text-hl-muted">
                {regionMeta(tournament.region).label} · {elim} · best of {tournament.bo}
              </p>
              <p className="mt-1 text-xs text-hl-muted">
                Results do not change ranked Elo. Pot split {tournament.potSplit.join(" / ")}.
              </p>
            </div>
            <div className="rounded-xl border border-hl-border bg-hl-base px-4 py-3 text-right min-w-[9rem]">
              <div className="text-[11px] font-bold uppercase tracking-wide text-hl-muted">Pot</div>
              <div className="text-2xl font-black text-hl-gold tabular-nums">{tournament.pot.toLocaleString()}</div>
              <div className="text-[11px] text-hl-muted">
                Entry {tournament.entryFee.toLocaleString()} · {tournament.teams.length}/{tournament.size}
              </div>
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-hl-base">
            <div
              className="h-full bg-gold-gradient"
              style={{ width: `${Math.min(100, Math.round((tournament.teams.length / tournament.size) * 100))}%` }}
            />
          </div>
          {tournament.mapPool.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tournament.mapPool.map((map) => (
                <span key={map} className="rounded-md bg-hl-base border border-hl-border px-2 py-0.5 text-xs text-hl-muted">
                  {map}
                </span>
              ))}
            </div>
          ) : null}
          {viewer.organizer && (open || tournament.status === "live") ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {open ? (
                <button
                  type="button"
                  disabled={busy || tournament.teams.length < 2}
                  onClick={() => void act({ action: "start" })}
                  className="h-9 rounded-xl bg-gold-gradient px-4 text-sm font-black text-hl-base disabled:opacity-40"
                >
                  Start bracket
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Cancel this cup and refund entry fees?")) void act({ action: "cancel" });
                }}
                className="h-9 rounded-xl border border-hl-red/40 px-4 text-sm font-bold text-hl-red"
              >
                Cancel cup
              </button>
            </div>
          ) : null}
          {error ? <p className="mt-3 text-sm text-hl-red">{error}</p> : null}
        </div>
      </Card>

      {showPrivateBlock ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-5">
          <div className="text-sm font-bold text-white">Private cup</div>
          <p className="mt-1 text-sm text-hl-muted">You need to be in the club to join.</p>
          {!session ? (
            <p className="mt-2 text-xs text-hl-muted">Log in if you are already in this club.</p>
          ) : null}
          {tournament.clubId && clubName ? (
            <Link href={`/clubs/${tournament.clubId}`} className="mt-3 inline-block text-xs font-bold text-hl-gold hover:underline">
              Open {clubName}
            </Link>
          ) : null}
        </Card>
      ) : null}

      {open && !session && tournament.kind === "official" && !onRoster ? (
        <p className="mb-5 text-sm text-hl-muted">Log in to request a team.</p>
      ) : null}

      {showRequest ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-5">
          <div className="text-sm font-bold text-white mb-2">Request a team</div>
          <p className="text-xs text-hl-muted mb-3">
            {tournament.entryFee > 0
              ? `Requesting charges ${tournament.entryFee.toLocaleString()} HL Coins now. ${reviewer} accept or deny. A denial refunds the fee.`
              : `${reviewer} accept or deny. This cup has no entry fee.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value.slice(0, 24))}
              placeholder="Team name"
              className={`${field} flex-1 min-w-[12rem]`}
            />
            <button
              type="button"
              disabled={busy || teamName.trim().length < 2}
              onClick={() => void act({ action: "request", teamName })}
              className="h-10 rounded-lg bg-gold-gradient px-4 text-sm font-black text-hl-base disabled:opacity-40"
            >
              {tournament.entryFee > 0 ? `Pay ${tournament.entryFee.toLocaleString()} & request` : "Request"}
            </button>
          </div>
        </Card>
      ) : null}
      {viewer.pendingRequest ? (
        <Card className="bg-hl-panel border-hl-gold/30 p-4 mb-5">
          <p className="text-sm text-white font-semibold">Your team request is waiting for {reviewer}.</p>
          <p className="mt-1 text-xs text-hl-muted">
            {tournament.entryFee > 0
              ? "The entry fee is held until the request is accepted or denied. A denial refunds it."
              : "You will be added as captain if the request is accepted."}
          </p>
        </Card>
      ) : null}

      {open && viewer.organizer && pendingRequests.length > 0 ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-5">
          <div className="text-sm font-bold text-white mb-3">Requests</div>
          <div className="space-y-2">
            {pendingRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-hl-border bg-hl-base px-3 py-2">
                <span className="text-sm text-white font-semibold">{r.teamName}</span>
                <span className="text-xs text-hl-muted">{r.playerName}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "review", requestId: r.id, accept: true })}
                  className="ml-auto h-8 rounded-lg bg-gold-gradient px-3 text-xs font-black text-hl-base"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "review", requestId: r.id, accept: false })}
                  className="h-8 rounded-lg border border-hl-border px-3 text-xs font-bold text-white"
                >
                  Deny & refund
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {open && viewer.organizer && tournament.kind === "community" ? (
        <Card className="bg-hl-panel border-hl-border p-4 mb-5">
          <div className="text-sm font-bold text-white mb-2">Add a team captain</div>
          <p className="text-xs text-hl-muted mb-3">
            Pick a club member. Their entry fee is charged now, then they invite the rest of the roster.
            Members can also request a team themselves.
          </p>
          <div className="flex flex-wrap gap-2 items-start">
            <PlayerSearch
              className="flex-1 min-w-[14rem]"
              placeholder="Search a club member"
              onPick={setCaptainName}
              onQueryChange={setCaptainName}
            />
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value.slice(0, 24))}
              placeholder="Team name"
              className={`${field} flex-1 min-w-[10rem]`}
            />
            <button
              type="button"
              disabled={busy || captainName.trim().length < 2 || teamName.trim().length < 2}
              onClick={() => void act({ action: "assignCaptain", playerName: captainName, teamName })}
              className="h-10 rounded-lg bg-gold-gradient px-4 text-sm font-black text-hl-base disabled:opacity-40"
            >
              Make captain
            </button>
          </div>
        </Card>
      ) : null}

      <div className="space-y-3 mb-6">
        {tournament.teams.length === 0 ? (
          <p className="text-sm text-hl-muted">No teams yet.</p>
        ) : (
          tournament.teams.map((team) => (
            <Card key={team.id} className="bg-hl-panel border-hl-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-black text-white">{team.name}</span>
                {team.seed ? <span className="text-xs text-hl-muted">Seed {team.seed}</span> : null}
                {team.placement ? (
                  <span className="text-xs font-bold text-hl-gold">#{team.placement}</span>
                ) : null}
                {(viewer.captainOf === team.id || viewer.organizer) && open ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Withdraw this team and refund the entry fee?")) {
                        void act({ action: "withdraw", teamId: team.id });
                      }
                    }}
                    className="ml-auto text-xs font-bold text-hl-red"
                  >
                    Withdraw
                  </button>
                ) : null}
              </div>
              <div className="mt-3 space-y-2">
                {team.members.map((m) => (
                  <div key={m.discordId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-white">{m.playerName || m.username}</span>
                    <span className="text-[10px] font-bold uppercase text-hl-muted">
                      {m.role}
                      {m.status === "invited" ? " · invited" : ""}
                    </span>
                    {viewer.captainOf === team.id && open && m.role !== "captain" ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act({
                              action: "slot",
                              teamId: team.id,
                              discordId: m.discordId,
                              slot: m.role === "starter" ? "sub" : "starter",
                            })
                          }
                          className="text-xs font-bold text-hl-gold"
                        >
                          Make {m.role === "starter" ? "sub" : "starter"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act({ action: "kick", teamId: team.id, discordId: m.discordId })}
                          className="text-xs font-bold text-hl-red"
                        >
                          Kick
                        </button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
              {viewer.inviteTeamId === team.id ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ action: "respond", teamId: team.id, accept: true })}
                    className="h-9 rounded-lg bg-gold-gradient px-3 text-xs font-black text-hl-base"
                  >
                    Accept invite
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ action: "respond", teamId: team.id, accept: false })}
                    className="h-9 rounded-lg border border-hl-border px-3 text-xs font-bold text-white"
                  >
                    Decline
                  </button>
                </div>
              ) : null}
              {viewer.captainOf === team.id && open ? (
                <div className="mt-3 flex flex-wrap gap-2 items-start">
                  <PlayerSearch
                    className="flex-1 min-w-[14rem]"
                    placeholder="Search a player to invite"
                    onPick={setInviteName}
                    onQueryChange={setInviteName}
                  />
                  <button
                    type="button"
                    disabled={busy || inviteName.trim().length < 2}
                    onClick={() => void act({ action: "invite", teamId: team.id, playerName: inviteName })}
                    className="h-10 rounded-lg border border-hl-border px-3 text-sm font-bold text-white"
                  >
                    Invite
                  </button>
                </div>
              ) : null}
            </Card>
          ))
        )}
      </div>

      {reportable.length > 0 ? (
        <div className="space-y-3 mb-6">
          <h2 className="text-sm font-bold text-white header-caps">Report scores</h2>
          {reportable.map((match) => {
            const rows = drafts[match.id] ?? blankScores();
            const teamA = names.get(match.teamAId || "") || "Team A";
            const teamB = names.get(match.teamBId || "") || "Team B";
            return (
              <Card key={match.id} className="bg-hl-panel border-hl-border p-4">
                <div className="text-sm font-bold text-white mb-3">
                  {roundLabel(match, tournament.size)} · {teamA} vs {teamB}
                </div>
                <div className="space-y-2">
                  {rows.map((row, index) => (
                    <div key={index} className="grid grid-cols-[1fr_5rem_5rem] gap-2">
                      <select
                        value={row.map}
                        onChange={(e) => {
                          const next = [...rows];
                          next[index] = { ...row, map: e.target.value };
                          setDrafts((cur) => ({ ...cur, [match.id]: next }));
                        }}
                        className={field}
                      >
                        {tournament.mapPool.map((map) => (
                          <option key={map} value={map}>
                            {map}
                          </option>
                        ))}
                      </select>
                      <input
                        value={row.scoreA}
                        placeholder={teamA.slice(0, 3)}
                        onChange={(e) => {
                          const next = [...rows];
                          next[index] = { ...row, scoreA: e.target.value.replace(/[^\d]/g, "").slice(0, 2) };
                          setDrafts((cur) => ({ ...cur, [match.id]: next }));
                        }}
                        className={field}
                      />
                      <input
                        value={row.scoreB}
                        placeholder={teamB.slice(0, 3)}
                        onChange={(e) => {
                          const next = [...rows];
                          next[index] = { ...row, scoreB: e.target.value.replace(/[^\d]/g, "").slice(0, 2) };
                          setDrafts((cur) => ({ ...cur, [match.id]: next }));
                        }}
                        className={field}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  {tournament.bo === 3 && rows.length < 3 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDrafts((cur) => ({
                          ...cur,
                          [match.id]: [...rows, { map: tournament.mapPool[0] || "", scoreA: "", scoreB: "" }],
                        }))
                      }
                      className="h-9 rounded-lg border border-hl-border px-3 text-xs font-bold text-white"
                    >
                      Add map
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act({
                        action: "report",
                        matchId: match.id,
                        scores: rows
                          .filter((r) => r.map && r.scoreA !== "" && r.scoreB !== "")
                          .map((r) => ({ map: r.map, scoreA: Number(r.scoreA), scoreB: Number(r.scoreB) })),
                      })
                    }
                    className="h-9 rounded-lg bg-gold-gradient px-3 text-xs font-black text-hl-base"
                  >
                    Submit score
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {winners ? (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-2">
            {tournament.bracket === "double" ? "Winners" : "Bracket"}
          </h2>
          <div className="rounded-xl border border-hl-border bg-hl-panel overflow-hidden">
            <BracketView bracket={winners} />
          </div>
        </div>
      ) : null}
      {losers ? (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-2">Losers</h2>
          <div className="rounded-xl border border-hl-border bg-hl-panel overflow-hidden">
            <BracketView bracket={losers} />
          </div>
        </div>
      ) : null}
      {grand ? (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-white header-caps mb-2">Grand final</h2>
          <div className="rounded-xl border border-hl-border bg-hl-panel overflow-hidden">
            <BracketView bracket={grand} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
