"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { ClubMark } from "@/components/club-identity";
import { useSession } from "@/components/session-provider";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { LeagueManage } from "@/components/league-manage";
import {
  CalendarDays,
  Check,
  Coins,
  Shield,
  Trophy,
  Users,
} from "lucide-react";

type SeasonStatus =
  | "draft"
  | "signup"
  | "drawn"
  | "regular"
  | "playoffs"
  | "finished"
  | "cancelled";

interface TeamBadge {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  accentColor: string;
}

interface StandingRow {
  teamId: string;
  team: TeamBadge;
  played: number;
  won: number;
  lost: number;
  rd: number;
  points: number;
  seedElo: number | null;
}

interface MatchRow {
  id: number;
  bo: number;
  status: string;
  scheduledAt: number | null;
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  teamA: TeamBadge;
  teamB: TeamBadge;
  mine: boolean;
  round?: "semi1" | "semi2" | "final" | "third" | null;
}

interface WeekRow {
  week: number;
  start: number | null;
  end: number | null;
  defaultSlot: number | null;
  matches: MatchRow[];
}

interface DivisionView {
  id: number;
  name: string;
  tier: number;
  standings: StandingRow[];
  weeks: WeekRow[];
  playoffs: {
    semi1: MatchRow | null;
    semi2: MatchRow | null;
    final: MatchRow | null;
    third: MatchRow | null;
  } | null;
  places: {
    place: number;
    team: TeamBadge;
    movement: "up" | "down" | null;
    prize: number;
  }[];
}

const ROUND_LABEL: Record<string, string> = {
  semi1: "Semi-final 1",
  semi2: "Semi-final 2",
  final: "Final",
  third: "Third place",
};

function PlayoffsPanel({ div }: { div: DivisionView }) {
  const p = div.playoffs;
  if (!p) return null;
  const slot = (m: MatchRow | null, label: string, hint: string) => (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-bold header-caps text-hl-muted">
        {label}
      </div>
      {m ? (
        <MatchLine m={m} />
      ) : (
        <div className="rounded-lg border border-dashed border-hl-border/60 px-3 py-3 text-center text-xs text-hl-muted">
          {hint}
        </div>
      )}
    </div>
  );
  return (
    <Card className="border-hl-gold/30 bg-hl-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-black header-caps text-white">Playoffs</h2>
        <span className="text-[11px] text-hl-muted">Best of 3 · top 4</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {slot(p.semi1, "Semi-final · 1st v 4th", "")}
          {slot(p.semi2, "Semi-final · 2nd v 3rd", "")}
        </div>
        <div className="space-y-3">
          {slot(p.final, "Final", "Winners of the semi-finals")}
          {slot(p.third, "Third place", "Losers of the semi-finals")}
        </div>
      </div>
    </Card>
  );
}

function PlacesPanel({ div }: { div: DivisionView }) {
  if (!div.places.length) return null;
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <Card className="border-hl-gold/40 bg-hl-panel p-4">
      <h2 className="mb-3 text-sm font-black header-caps text-white">
        Final standings
      </h2>
      <div className="space-y-1.5">
        {div.places.map((p) => (
          <div
            key={p.team.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-hl-base/50 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-6 text-center text-sm font-black text-hl-gold">
                {medal[p.place - 1] ?? p.place}
              </span>
              <TeamName team={p.team} />
            </div>
            <span className="text-[11px] text-hl-muted">
              {p.prize ? (
                <span className="inline-flex items-center gap-1 text-hl-gold">
                  <Coins className="h-3 w-3" /> {p.prize.toLocaleString()} each
                </span>
              ) : null}
              {p.movement === "up" ? (
                <span className="ml-2 text-hl-green">⬆ promoted</span>
              ) : null}
              {p.movement === "down" ? (
                <span className="ml-2 text-hl-red">⬇ relegated</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

interface EntryRow {
  teamId: string;
  team: TeamBadge;
  seedElo: number | null;
  status: "signed_up" | "active" | "ineligible";
  note: string | null;
  divisionId: number | null;
  rosterSize: number;
  roster: string[];
}

interface CaptainTeam extends TeamBadge {
  memberCount: number;
  problems: string[];
  seedElo: number | null;
  signedUp: boolean;
}

interface LeagueData {
  /** Match Staff see the Manage tab. */
  staff?: boolean;
  seasons: { id: number; name: string; status: SeasonStatus }[];
  season: {
    id: number;
    name: string;
    status: SeasonStatus;
    signupClose: number | null;
    startDate: number | null;
    weeks: number;
  } | null;
  prizes: number[];
  roster: { min: number; max: number };
  entries: EntryRow[];
  divisions: DivisionView[];
  viewer: { captainTeams: CaptainTeam[]; myTeamIds: string[] } | null;
}

const PHASES: { key: SeasonStatus[]; label: string }[] = [
  { key: ["draft", "signup"], label: "Sign-ups" },
  { key: ["drawn"], label: "Divisions" },
  { key: ["regular"], label: "Regular season" },
  { key: ["playoffs"], label: "Playoffs" },
  { key: ["finished"], label: "Finished" },
];

const STATUS_TEXT: Record<SeasonStatus, string> = {
  draft: "Sign-ups open soon",
  signup: "Sign-ups open",
  drawn: "Divisions drawn — season starts soon",
  regular: "Regular season",
  playoffs: "Playoffs",
  finished: "Finished",
  cancelled: "Cancelled",
};

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function fmtDateTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TeamName({ team, mine }: { team: TeamBadge; mine?: boolean }) {
  return (
    <Link
      href={`/teams/${team.id}`}
      className="flex min-w-0 items-center gap-2 hover:underline"
    >
      <ClubMark
        tag={team.tag}
        accentColor={team.accentColor}
        logoUrl={team.logoUrl}
        size={24}
      />
      <span
        className={`truncate text-sm font-bold ${mine ? "text-hl-gold" : "text-white"}`}
      >
        {team.name}
      </span>
      {team.tag ? (
        <span className="shrink-0 text-[11px] text-hl-muted">[{team.tag}]</span>
      ) : null}
    </Link>
  );
}

function PhaseBar({ status }: { status: SeasonStatus }) {
  const at = PHASES.findIndex((p) => p.key.includes(status));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PHASES.map((p, i) => (
        <span
          key={p.label}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold header-caps ${
            i === at
              ? "border-transparent bg-gold-gradient text-hl-base"
              : i < at
                ? "border-hl-border text-white/70"
                : "border-hl-border/60 text-hl-muted"
          }`}
        >
          {i < at ? <Check className="mr-1 inline h-3 w-3" /> : null}
          {p.label}
        </span>
      ))}
    </div>
  );
}

function MatchLine({ m }: { m: MatchRow }) {
  const done = m.status === "final" || m.status === "forfeit";
  const aWon = done && m.winner === m.teamA.id;
  const bWon = done && m.winner === m.teamB.id;
  let middle: string;
  if (m.status === "forfeit") middle = aWon ? "W – FF" : "FF – W";
  else if (done) middle = `${m.scoreA ?? 0} – ${m.scoreB ?? 0}`;
  else middle = "vs";
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-2 rounded-lg px-3 py-2 ${
        m.mine
          ? "bg-hl-gold/[0.07] border border-hl-gold/25"
          : "bg-hl-base/50 border border-hl-border/60"
      }`}
    >
      <div className={`flex justify-end ${bWon ? "opacity-60" : ""}`}>
        <TeamName team={m.teamA} />
      </div>
      <Link
        href={`/league/match/${m.id}`}
        className="rounded-md text-center hover:bg-white/[0.05]"
        title="Match page"
      >
        <div
          className={`text-sm font-black tabular-nums ${done ? "text-white" : "text-hl-muted"}`}
        >
          {middle}
        </div>
        <div className="text-[10px] text-hl-muted">
          {m.status === "live"
            ? "Live"
            : m.status === "reported" || m.status === "disputed"
              ? "Result pending"
              : m.scheduledAt && !done
                ? fmtDateTime(m.scheduledAt)
                : `BO${m.bo}`}
        </div>
      </Link>
      <div className={aWon ? "opacity-60" : ""}>
        <TeamName team={m.teamB} />
      </div>
    </div>
  );
}

function DivisionPanel({
  div,
  myTeamIds,
}: {
  div: DivisionView;
  myTeamIds: string[];
}) {
  const playoffLine = 4;
  return (
    <div className="space-y-5">
      <PlacesPanel div={div} />
      <PlayoffsPanel div={div} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="border-hl-border bg-hl-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black header-caps text-white">
              Standings
            </h2>
            <span className="text-[11px] text-hl-muted">
              Win 3 pts · top {playoffLine} make the playoffs
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-[11px] header-caps text-hl-muted">
                  <th className="w-8 py-2">#</th>
                  <th className="py-2">Team</th>
                  <th className="w-10 py-2 text-center">P</th>
                  <th className="w-10 py-2 text-center">W</th>
                  <th className="w-10 py-2 text-center">L</th>
                  <th className="w-12 py-2 text-center">RD</th>
                  <th className="w-12 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {div.standings.map((row, i) => {
                  const mine = myTeamIds.includes(row.teamId);
                  return (
                    <tr
                      key={row.teamId}
                      className={`border-t border-hl-border/60 ${i === playoffLine - 1 ? "border-b border-b-hl-gold/40" : ""} ${
                        mine ? "bg-hl-gold/[0.06]" : ""
                      }`}
                    >
                      <td
                        className={`py-2 font-black tabular-nums ${i < playoffLine ? "text-hl-gold" : "text-hl-muted"}`}
                      >
                        {i + 1}
                      </td>
                      <td className="py-2 pr-2">
                        <TeamName team={row.team} mine={mine} />
                      </td>
                      <td className="py-2 text-center tabular-nums text-white/80">
                        {row.played}
                      </td>
                      <td className="py-2 text-center tabular-nums text-hl-green">
                        {row.won}
                      </td>
                      <td className="py-2 text-center tabular-nums text-hl-red">
                        {row.lost}
                      </td>
                      <td className="py-2 text-center tabular-nums text-white/80">
                        {row.rd > 0 ? `+${row.rd}` : row.rd}
                      </td>
                      <td className="py-2 text-right font-black tabular-nums text-white">
                        {row.points}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="border-hl-border bg-hl-panel p-4">
          <h2 className="mb-3 text-sm font-black header-caps text-white">
            Schedule
          </h2>
          {div.weeks.length === 0 ? (
            <p className="py-6 text-center text-sm text-hl-muted">
              The schedule is published when Match Staff start the season.
            </p>
          ) : (
            <div className="space-y-4">
              {div.weeks.map((w) => (
                <div key={w.week}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-black header-caps text-white">
                      Week {w.week}
                      {w.start && w.end ? (
                        <span className="ml-2 font-semibold normal-case tracking-normal text-hl-muted">
                          {fmtDate(w.start)} – {fmtDate(w.end)}
                        </span>
                      ) : null}
                    </span>
                    {w.defaultSlot ? (
                      <span className="text-[10px] text-hl-muted">
                        No agreed time → {fmtDateTime(w.defaultSlot)}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    {w.matches.map((m) => (
                      <div key={m.id}>
                        {m.round ? (
                          <div className="mb-0.5 text-[10px] font-bold header-caps text-hl-gold">
                            {ROUND_LABEL[m.round]}
                          </div>
                        ) : null}
                        <MatchLine m={m} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SignUpPanel({
  data,
  onAction,
  busy,
}: {
  data: LeagueData;
  onAction: (action: "signup" | "withdraw", teamId: string) => void;
  busy: string | null;
}) {
  const { session } = useSession();
  const captainTeams = data.viewer?.captainTeams ?? [];
  if (!session) {
    return (
      <Card className="border-hl-border bg-hl-panel p-4 text-sm text-hl-muted">
        <Link href="/login" className="font-bold text-hl-gold hover:underline">
          Log in
        </Link>{" "}
        to sign your team up.
      </Card>
    );
  }
  return (
    <Card className="border-hl-border bg-hl-panel p-4">
      <h2 className="mb-1 text-sm font-black header-caps text-white">
        Sign up your team
      </h2>
      <p className="mb-3 text-xs text-hl-muted">
        Captains only. Rosters need {data.roster.min}–{data.roster.max} accepted
        members, all linked to a player, and each player can play for one team
        per season. Rosters lock when sign-ups close.
      </p>
      {captainTeams.length === 0 ? (
        <p className="text-sm text-hl-muted">
          You don&apos;t captain a team yet.{" "}
          <Link
            href="/teams"
            className="font-bold text-hl-gold hover:underline"
          >
            Create one
          </Link>{" "}
          and invite your players first.
        </p>
      ) : (
        <div className="space-y-2">
          {captainTeams.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hl-border/60 bg-hl-base/50 px-3 py-2.5"
            >
              <div className="min-w-0">
                <TeamName team={t} />
                <div className="mt-1 text-[11px] text-hl-muted">
                  {t.memberCount} members
                  {t.seedElo
                    ? ` · ${t.seedElo.toLocaleString()} avg Elo (top 5)`
                    : ""}
                </div>
                {!t.signedUp && t.problems.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-hl-red">
                    {t.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {data.season?.status === "signup" ? (
                t.signedUp ? (
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() => onAction("withdraw", t.id)}
                    className="h-8 rounded-lg border border-hl-border px-3 text-xs font-bold text-hl-muted hover:text-white disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy === t.id || t.problems.length > 0}
                    onClick={() => onAction("signup", t.id)}
                    className="find-match-btn h-8 rounded-lg px-3 text-xs font-black header-caps text-hl-base disabled:opacity-40"
                  >
                    Sign up
                  </button>
                )
              ) : t.signedUp ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-hl-green">
                  <Check className="h-3.5 w-3.5" /> Signed up
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function EntryList({ entries, title }: { entries: EntryRow[]; title: string }) {
  return (
    <Card className="border-hl-border bg-hl-panel p-4">
      <h2 className="mb-3 text-sm font-black header-caps text-white">
        {title} <span className="text-hl-muted">({entries.length})</span>
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-hl-muted">No teams yet.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div
              key={e.teamId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-hl-base/50 px-3 py-2"
            >
              <TeamName team={e.team} />
              <span
                className="text-[11px] text-hl-muted"
                title={e.roster.join(", ")}
              >
                {e.status === "ineligible" ? (
                  <span className="text-hl-red">{e.note}</span>
                ) : (
                  <>
                    {e.rosterSize} players
                    {e.seedElo ? ` · ${e.seedElo.toLocaleString()} Elo` : ""}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function LeaguePage() {
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<LeagueData | null>(null);
  const [failed, setFailed] = useState(false);
  const [divTab, setDivTab] = useState<number | null>(null);
  const [tab, setTab] = useState<"league" | "manage">("league");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = `/api/league${seasonId ? `?season=${seasonId}` : ""}`;
    apiGetJson<LeagueData>(url, { force: true })
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok && json) {
          setData(json);
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [seasonId, reload]);

  const act = async (action: "signup" | "withdraw", teamId: string) => {
    setBusy(teamId);
    setError(null);
    try {
      const res = await fetch("/api/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, teamId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error || "Something went wrong.");
      invalidateClientApi();
      setReload((n) => n + 1);
    } finally {
      setBusy(null);
    }
  };

  const season = data?.season ?? null;
  const myTeamIds = data?.viewer?.myTeamIds ?? [];
  const divisions = data?.divisions ?? [];
  const myDivision = divisions.find((d) =>
    d.standings.some((r) => myTeamIds.includes(r.teamId)),
  );
  const activeDiv =
    divisions.find((d) => d.id === divTab) ??
    myDivision ??
    divisions[0] ??
    null;
  const signupPhase = season?.status === "draft" || season?.status === "signup";
  const ineligible = (data?.entries ?? []).filter(
    (e) => e.status === "ineligible",
  );
  const nextMatch =
    divisions
      .flatMap((d) =>
        d.weeks.flatMap((w) => w.matches.map((m) => ({ ...m, week: w.week }))),
      )
      .filter((m) => m.mine && m.status !== "final" && m.status !== "forfeit")
      .sort((a, b) => a.week - b.week || a.id - b.id)[0] ?? null;

  return (
    <div className="hl-page-wide">
      <PageHeader
        icon={Trophy}
        title="League"
        subtitle="Team League · 6 weeks + playoffs · BO1 regular season, BO3 playoffs · doesn't affect ranked Elo"
        actions={
          data && data.seasons.length > 1 ? (
            <select
              value={season?.id ?? ""}
              onChange={(e) => {
                setSeasonId(Number(e.target.value));
                setDivTab(null);
              }}
              className="h-9 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white"
            >
              {data.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {data?.staff ? (
        <div className="mb-5 flex gap-6 border-b border-hl-border">
          {(["league", "manage"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 pb-2.5 text-sm font-bold header-caps ${
                tab === t
                  ? "border-hl-gold text-hl-gold"
                  : "border-transparent text-hl-muted hover:text-white"
              }`}
            >
              {t === "league" ? "League" : "Manage (staff)"}
            </button>
          ))}
        </div>
      ) : null}

      {data?.staff && tab === "manage" ? (
        <LeagueManage onChanged={() => setReload((n) => n + 1)} />
      ) : null}

      {!data && !failed ? (
        <div className="py-16 text-center text-sm text-hl-muted">Loading…</div>
      ) : null}
      {failed && !data ? (
        <div className="py-16 text-center text-sm text-hl-muted">
          Couldn&apos;t load the league. Try again soon.
        </div>
      ) : null}

      {data && !season && !(data.staff && tab === "manage") ? (
        <Card className="border-hl-border bg-hl-panel p-8 text-center">
          <Trophy className="mx-auto mb-3 h-8 w-8 text-hl-gold" />
          <h2 className="text-lg font-black text-white">No season yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-hl-muted">
            Match Staff announce sign-ups on Discord and here. Get ready by
            creating a team and inviting {data.roster.min}–{data.roster.max}{" "}
            players.
          </p>
          <Link
            href="/teams"
            className="find-match-btn mt-4 inline-flex h-9 items-center rounded-xl px-4 text-sm font-black header-caps text-hl-base"
          >
            My teams
          </Link>
        </Card>
      ) : null}

      {data && season && !(data.staff && tab === "manage") ? (
        <div className="space-y-5">
          <Card className="relative overflow-hidden border-hl-border bg-hl-panel p-5">
            <div className="absolute inset-0 bg-hero-radial opacity-60 pointer-events-none" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold header-caps text-hl-gold">
                  {STATUS_TEXT[season.status]}
                </div>
                <h2 className="mt-1 text-2xl font-black text-white">
                  {season.name}
                </h2>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-hl-muted">
                  {season.status === "signup" && season.signupClose ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> Sign-ups close{" "}
                      {fmtDateTime(season.signupClose)}
                    </span>
                  ) : null}
                  {season.startDate ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> Week 1:{" "}
                      {fmtDate(season.startDate)}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />{" "}
                    {
                      data.entries.filter((e) => e.status !== "ineligible")
                        .length
                    }{" "}
                    teams
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Shield className="h-3.5 w-3.5" /> Free entry
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-hl-border bg-hl-base/60 px-3 py-2">
                <div className="mb-1 text-[10px] header-caps text-hl-muted">
                  Prizes per player · each division
                </div>
                <div className="flex gap-3 text-sm font-black">
                  {data.prizes.map((p, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-hl-gold"
                    >
                      <span className="text-white/70">
                        {["1st", "2nd", "3rd"][i]}
                      </span>
                      <Coins className="h-3.5 w-3.5" />
                      {p.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative mt-4">
              <PhaseBar status={season.status} />
            </div>
          </Card>

          {error ? <p className="text-sm text-hl-red">{error}</p> : null}

          {signupPhase ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <SignUpPanel data={data} onAction={act} busy={busy} />
              <EntryList entries={data.entries} title="Signed up" />
            </div>
          ) : (
            <>
              {nextMatch ? (
                <Card className="flex flex-wrap items-center justify-between gap-3 border-hl-gold/40 bg-hl-panel p-4">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold header-caps text-hl-gold">
                      Your next match · Week {nextMatch.week}
                    </div>
                    <div className="mt-1 truncate text-sm font-black text-white">
                      {nextMatch.teamA.name} vs {nextMatch.teamB.name}
                    </div>
                    <div className="text-xs text-hl-muted">
                      {nextMatch.scheduledAt
                        ? fmtDateTime(nextMatch.scheduledAt)
                        : nextMatch.status === "proposed"
                          ? "A time was proposed — the captains need to agree"
                          : "No time agreed yet"}
                    </div>
                  </div>
                  <Link
                    href={`/league/match/${nextMatch.id}`}
                    className="find-match-btn inline-flex h-9 items-center rounded-xl px-4 text-xs font-black header-caps text-hl-base"
                  >
                    Match page
                  </Link>
                </Card>
              ) : null}
              {divisions.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {divisions.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDivTab(d.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        activeDiv?.id === d.id
                          ? "border-transparent bg-gold-gradient text-hl-base"
                          : "border-hl-border text-hl-muted hover:text-white"
                      }`}
                    >
                      {d.name}
                      {myDivision?.id === d.id ? " · your team" : ""}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeDiv ? (
                <DivisionPanel div={activeDiv} myTeamIds={myTeamIds} />
              ) : null}
              {ineligible.length > 0 ? (
                <EntryList entries={ineligible} title="Not placed" />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
