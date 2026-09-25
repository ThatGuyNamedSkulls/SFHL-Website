"use client";

/**
 * League → Manage (Match Staff only): run a season from the website — the
 * same steps as the bot's /league commands. Server-side checks live in
 * lib/league-admin.ts; this is just the controls.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { apiGetJson, invalidateClientApi } from "@/lib/client-api";
import { AlertTriangle, History, Megaphone, Settings2, Trash2 } from "lucide-react";

type SeasonStatus = "draft" | "signup" | "drawn" | "regular" | "playoffs" | "finished" | "cancelled";

type SeasonRef = { id: number; name: string; status: SeasonStatus } | null;

const ACCESS_OPTIONS: [string, string][] = [
  ["open", "Open (by skill)"],
  ["pro", "Pro Access"],
  ["advanced", "Advanced Access"],
  ["main", "Main Access"],
  ["intermediate", "Intermediate Access"],
  ["entry", "Entry Access"],
  ["open10", "Open 10 Access (earned)"],
];

/** Division names for the season-end moves (same codes as lib/league.ts). */
const MOVE_NAMES: Record<string, string> = {
  pro: "Pro",
  advanced: "Advanced",
  main: "Main",
  intermediate: "Intermediate",
  entry: "Entry",
  open10: "Open 10",
  "": "skill band",
};

interface AdminData {
  live: SeasonRef;
  upcoming: SeasonRef;
  season: {
    id: number;
    name: string;
    status: SeasonStatus;
    signupClose: number | null;
    startDate: number | null;
    weeks: number;
    bannerUrl?: string | null;
    description?: string | null;
    rules?: string | null;
    notice?: string | null;
  } | null;
  canCreate: boolean;
  openRegular: number;
  openPlayoffs: number;
  playoffFinalsCreated: number;
  entries: {
    access: string | null;
    teamId: string;
    name: string;
    tag: string;
    seedElo: number | null;
    status: "signed_up" | "active" | "ineligible";
    note: string | null;
    divisionId: number | null;
    roster: string[];
  }[];
  divisions: { id: number; name: string; tier: number; teams: number }[];
  needsStaff: { matchId: number; week: number; teams: string; reason: string }[];
  events: { id: number; kind: string; actor: string | null; source: string; detail: string; createdAt: number; matchId: number | null }[];
  channelId: string | null;
}

interface DrawPlan {
  divisions: { name: string; tier: number; teams: { teamId: string; name: string; tag: string; seedElo: number }[] }[];
  notPlaced: { teamId: string; name: string; note: string }[];
}

interface EndPlan {
  divisions: {
    divisionId: number;
    name: string;
    tier: number;
    places: string[];
    champion: string;
    moves: { teamId: string; direction: "up" | "down"; to: string }[];
  }[];
}

interface StartPlan {
  firstWeek: number;
  ok: boolean;
  divisions: { id: number; name: string; teams: number; matches: number; problem: string | null }[];
}

const EVENT_TEXT: Record<string, string> = {
  season_created: "created the season",
  playoffs_started: "started the playoffs",
  season_finished: "ended the season (titles + prizes)",
  signups_opened: "opened sign-ups",
  divisions_drawn: "closed sign-ups and drew the divisions",
  team_moved: "moved a team",
  team_removed: "removed a team",
  season_started: "started the season",
  season_cancelled: "cancelled the season",
  channel_set: "set the league channel",
  result_set: "set a result",
  match_rescheduled: "moved a match",
};

const btn =
  "h-9 rounded-lg px-3 text-xs font-black header-caps disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `find-match-btn text-hl-base ${btn}`;
const secondary = `border border-hl-border text-white hover:border-hl-gold/50 ${btn}`;
const input =
  "h-9 rounded-lg border border-hl-border bg-hl-base px-3 text-sm text-white placeholder:text-hl-muted [color-scheme:dark]";

function fmt(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function LeagueManage({
  onChanged,
  initialSeasonId = null,
}: {
  onChanged?: () => void;
  initialSeasonId?: number | null;
}) {
  const [data, setData] = useState<AdminData | null>(null);
  const [seasonPick, setSeasonPick] = useState<number | null>(initialSeasonId);
  const [details, setDetails] = useState<{ name: string; bannerUrl: string; description: string; rules: string; notice: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [firstWeek, setFirstWeek] = useState("");
  const [drawPlan, setDrawPlan] = useState<DrawPlan | null>(null);
  const [startPlan, setStartPlan] = useState<StartPlan | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [endPlan, setEndPlan] = useState<EndPlan | null>(null);
  const [endConfirm, setEndConfirm] = useState("");
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [channelPick, setChannelPick] = useState("");

  useEffect(() => {
    let alive = true;
    apiGetJson<AdminData & { error?: string }>(`/api/league/admin${seasonPick ? `?season=${seasonPick}` : ""}`, { force: true })
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok && json) {
          setData(json);
          setFailed(null);
        } else setFailed(json?.error ?? "Couldn't load the Manage tab.");
      })
      .catch(() => alive && setFailed("Couldn't load the Manage tab."));
    return () => {
      alive = false;
    };
  }, [reload, seasonPick]);

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/league/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, seasonId: data?.season?.id, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Something went wrong.");
        return null;
      }
      return json as { ok?: boolean; preview?: unknown; result?: unknown };
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: string, extra: Record<string, unknown>, done: string) => {
    const json = await post(action, extra);
    if (!json) return;
    setNotice(done);
    setDrawPlan(null);
    setStartPlan(null);
    setEndPlan(null);
    invalidateClientApi();
    setReload((n) => n + 1);
    onChanged?.();
  };

  const loadChannels = async () => {
    const { ok, json } = await apiGetJson<{ channels?: { id: string; name: string }[]; error?: string }>(
      "/api/league/admin?channels=1",
      { force: true }
    );
    if (!ok) setError(json?.error ?? "Couldn't load the server's channels.");
    else setChannels(json.channels ?? []);
  };

  if (failed && !data) return <Card className="border-hl-border bg-hl-panel p-6 text-sm text-hl-muted">{failed}</Card>;
  if (!data) return <div className="py-10 text-center text-sm text-hl-muted">Loading…</div>;

  const season = data.season;
  const placed = data.entries.filter((e) => e.status === "active");
  const nameOf = (teamId: string) => data.entries.find((e) => e.teamId === teamId)?.name ?? teamId;
  const channelName = channels?.find((c) => c.id === data.channelId)?.name;

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      {notice ? <p className="text-sm text-hl-green">{notice}</p> : null}

      {/* Live + upcoming seasons run side by side: pick which one to manage. */}
      {data.live && data.upcoming ? (
        <div className="flex flex-wrap gap-2">
          {[data.live, data.upcoming].map((s) => (
            <button
              key={s!.id}
              type="button"
              onClick={() => {
                setSeasonPick(s!.id);
                setDetails(null);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${
                season?.id === s!.id
                  ? "border-transparent bg-gold-gradient text-hl-base"
                  : "border-hl-border text-hl-muted hover:text-white"
              }`}
            >
              {s!.name} · {s === data.live ? "live" : "upcoming"}
            </button>
          ))}
        </div>
      ) : null}

      {/* The next step for the season. */}
      <Card className="border-hl-gold/40 bg-hl-panel p-5">
        <div className="mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-hl-gold" />
          <h2 className="text-sm font-black header-caps text-white">
            {season ? `${season.name} · next step` : "Start a new season"}
          </h2>
        </div>

        {!season || data.canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="Season name (optional, e.g. Season 2)"
              className={`${input} min-w-[240px]`}
            />
            <button type="button" disabled={busy} className={primary} onClick={() => run("create", { name }, "Season created.")}>
              Create season
            </button>
          </div>
        ) : null}

        {season?.status === "draft" || season?.status === "signup" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-white">
              {season.status === "signup" && season.signupClose ? (
                <span className="text-xs text-hl-muted">Sign-ups close {fmt(season.signupClose)}. </span>
              ) : null}
              <span className="text-xs text-hl-muted">{season.status === "draft" ? "Open sign-ups for" : "Change the deadline to"}</span>
              <select value={days} onChange={(e) => setDays(e.target.value)} className={input}>
                {[1, 2, 3, 5, 7, 10, 14, 21, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} day{d === 1 ? "" : "s"} from now
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                className={season.status === "draft" ? primary : secondary}
                onClick={() => run("openSignups", { days: Number(days) }, "Sign-ups are open.")}
              >
                {season.status === "draft" ? "Open sign-ups" : "Update deadline"}
              </button>
            </div>
            {season.status === "signup" ? (
              <div className="border-t border-hl-border/60 pt-3">
                <p className="mb-2 text-xs text-hl-muted">
                  Closing sign-ups locks every roster, drops teams that break the rules and places the rest into
                  divisions by their top-5 average Elo. Preview it first.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={secondary}
                    onClick={async () => {
                      const json = await post("previewDraw");
                      if (json) setDrawPlan(json.preview as DrawPlan);
                    }}
                  >
                    Preview the draw
                  </button>
                  <button
                    type="button"
                    disabled={busy || !drawPlan}
                    title={drawPlan ? undefined : "Preview the draw first"}
                    className={primary}
                    onClick={() => run("closeSignups", {}, "Sign-ups closed — divisions drawn.")}
                  >
                    Close sign-ups &amp; draw
                  </button>
                </div>
                {drawPlan ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {drawPlan.divisions.map((d) => (
                      <div key={d.tier} className="rounded-lg border border-hl-border/60 bg-hl-base/50 p-3">
                        <div className="mb-1 text-xs font-black header-caps text-white">
                          {d.name} · {d.teams.length} teams
                        </div>
                        {d.teams.map((t, i) => (
                          <div key={t.teamId} className="flex justify-between text-xs text-white/85">
                            <span>
                              {i + 1}. {t.name} {t.tag ? <span className="text-hl-muted">[{t.tag}]</span> : null}
                            </span>
                            <span className="tabular-nums text-hl-muted">{t.seedElo} Elo</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {drawPlan.notPlaced.length ? (
                      <div className="rounded-lg border border-hl-red/40 bg-hl-base/50 p-3 md:col-span-2">
                        <div className="mb-1 text-xs font-black header-caps text-hl-red">Not placed</div>
                        {drawPlan.notPlaced.map((t) => (
                          <div key={t.teamId} className="text-xs text-white/85">
                            {t.name} — <span className="text-hl-muted">{t.note}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {season?.status === "drawn" ? (
          <div className="space-y-3">
            <p className="text-xs text-hl-muted">
              Rosters are locked. Move teams between divisions below if needed (each needs 4–7 teams), then pick the
              Monday of week 1. Leave it empty for next Monday.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={firstWeek} onChange={(e) => setFirstWeek(e.target.value)} className={input} />
              <button
                type="button"
                disabled={busy}
                className={secondary}
                onClick={async () => {
                  const json = await post("previewStart", { firstWeek });
                  if (json) setStartPlan(json.preview as StartPlan);
                }}
              >
                Preview the schedule
              </button>
              <button
                type="button"
                disabled={busy || !startPlan?.ok}
                title={startPlan ? undefined : "Preview the schedule first"}
                className={primary}
                onClick={() => run("start", { firstWeek }, "The season has started.")}
              >
                Start season
              </button>
            </div>
            {startPlan ? (
              <div className="rounded-lg border border-hl-border/60 bg-hl-base/50 p-3 text-xs text-white/85">
                <div className="mb-1 font-bold text-white">Week 1 starts {fmtDay(startPlan.firstWeek)} (UTC)</div>
                {startPlan.divisions.map((d) => (
                  <div key={d.id} className={d.problem ? "text-hl-red" : ""}>
                    {d.name}: {d.problem ?? `${d.teams} teams · ${d.matches} matches`}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {season?.status === "regular" ? (
          <div className="space-y-3">
            <p className="text-sm text-white">
              The regular season is running. The bot opens match rooms, sends reminders and sets default slots on its
              own — you only need to handle what shows up under &ldquo;Needs staff&rdquo;.
            </p>
            <div className="flex flex-wrap items-center gap-3 border-t border-hl-border/60 pt-3">
              <button
                type="button"
                disabled={busy || data.openRegular > 0}
                className={primary}
                onClick={() => run("startPlayoffs", {}, "Playoffs started — semi-finals are set.")}
              >
                Start playoffs
              </button>
              <span className="text-xs text-hl-muted">
                {data.openRegular > 0
                  ? `${data.openRegular} regular-season match${data.openRegular === 1 ? "" : "es"} still need a result.`
                  : "Top 4 of each division: semi-finals 1 v 4 and 2 v 3, best of 3."}
              </span>
            </div>
          </div>
        ) : null}

        {season?.status === "playoffs" ? (
          <div className="space-y-3">
            <p className="text-sm text-white">
              Playoffs are running (best of 3). The final and third-place match appear on their own once both
              semi-finals are done.
            </p>
            <div className="border-t border-hl-border/60 pt-3">
              <p className="mb-2 text-xs text-hl-muted">
                {data.openPlayoffs > 0 || data.playoffFinalsCreated < data.divisions.length
                  ? "Ending the season unlocks once every final and third-place match has a result."
                  : "Every playoff match is done. Ending the season sets the final places, awards the champion titles, pays the HL Coin prizes and moves teams up and down the ladder (each captain gets a DM)."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || data.openPlayoffs > 0 || data.playoffFinalsCreated < data.divisions.length}
                  className={secondary}
                  onClick={async () => {
                    const json = await post("previewEnd");
                    if (json) setEndPlan(json.preview as EndPlan);
                  }}
                >
                  Preview the season end
                </button>
              </div>
              {endPlan ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {endPlan.divisions.map((d) => (
                      <div key={d.divisionId} className="rounded-lg border border-hl-border/60 bg-hl-base/50 p-3 text-xs">
                        <div className="mb-1 font-black header-caps text-white">{d.name}</div>
                        {d.places.map((teamId, i) => {
                          const move = d.moves.find((m) => m.teamId === teamId);
                          return (
                            <div key={teamId} className="flex justify-between gap-2 text-white/85">
                              <span>
                                {i + 1}. {nameOf(teamId)}
                              </span>
                              <span className="text-right text-hl-muted">
                                {i < 3 ? `${[5000, 2500, 1000][i].toLocaleString()} coins each` : ""}
                                {move ? (
                                  <span className={`ml-2 font-bold ${move.direction === "up" ? "text-hl-green" : "text-hl-red"}`}>
                                    {move.direction === "up" ? "⏫" : "⏬"} {MOVE_NAMES[move.to] ?? move.to}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={endConfirm}
                      onChange={(e) => setEndConfirm(e.target.value)}
                      placeholder={`Type ${season.name} to confirm`}
                      className={input}
                    />
                    <button
                      type="button"
                      disabled={busy || endConfirm.trim() !== season.name}
                      className={primary}
                      onClick={() => run("endSeason", { confirmName: endConfirm }, `${season.name} is finished.`)}
                    >
                      End season &amp; pay prizes
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {season?.status === "finished" ? (
          <p className="text-sm text-white">{season.name} is finished. Create the next season when you&apos;re ready.</p>
        ) : null}
      </Card>

      {/* Matches that need a decision. */}
      {season && (season.status === "regular" || season.status === "playoffs") ? (
        <Card className="border-hl-border bg-hl-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-hl-gold" />
            <h2 className="text-sm font-black header-caps text-white">Needs staff ({data.needsStaff.length})</h2>
          </div>
          {data.needsStaff.length === 0 ? (
            <p className="text-sm text-hl-muted">Nothing right now.</p>
          ) : (
            <div className="space-y-1.5">
              {data.needsStaff.map((n) => (
                <Link
                  key={n.matchId}
                  href={`/league/match/${n.matchId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-hl-base/50 px-3 py-2 hover:bg-white/[0.05]"
                >
                  <span className="text-sm font-bold text-white">
                    Week {n.week} · {n.teams}
                  </span>
                  <span className="text-xs text-hl-gold">{n.reason}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* Teams in the season. */}
      {season && data.entries.length ? (
        <Card className="border-hl-border bg-hl-panel p-4">
          <h2 className="mb-3 text-sm font-black header-caps text-white">
            Teams ({placed.length || data.entries.length})
          </h2>
          <div className="space-y-1.5">
            {data.entries.map((e) => (
              <div
                key={e.teamId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-hl-base/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <Link href={`/teams/${e.teamId}`} className="text-sm font-bold text-white hover:underline">
                    {e.name} {e.tag ? <span className="text-hl-muted">[{e.tag}]</span> : null}
                  </Link>
                  <div className="text-[11px] text-hl-muted" title={e.roster.join(", ")}>
                    {e.roster.length} players{e.seedElo ? ` · ${e.seedElo} Elo` : ""}
                    {e.status === "ineligible" ? <span className="text-hl-red"> · not placed: {e.note}</span> : null}
                  </div>
                  <div className="mt-1">
                    <select
                      value={e.access ?? "open"}
                      disabled={busy}
                      title="League status — set by promotion/relegation at season end, stays with the team between seasons"
                      onChange={(ev) =>
                        run("setAccess", { teamId: e.teamId, access: ev.target.value }, `${e.name}: league status updated.`)
                      }
                      className="h-7 rounded-md border border-hl-border bg-hl-base px-2 text-[11px] text-white"
                    >
                      {ACCESS_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {season.status === "drawn" && e.status === "active" ? (
                    <select
                      value={e.divisionId ?? ""}
                      disabled={busy}
                      onChange={(ev) =>
                        run("moveTeam", { teamId: e.teamId, divisionId: Number(ev.target.value) }, `Moved ${e.name}.`)
                      }
                      className={input}
                    >
                      {data.divisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.teams})
                        </option>
                      ))}
                    </select>
                  ) : e.divisionId ? (
                    <span className="text-xs text-hl-muted">
                      {data.divisions.find((d) => d.id === e.divisionId)?.name}
                    </span>
                  ) : null}
                  {season.status === "signup" || season.status === "drawn" ? (
                    <button
                      type="button"
                      disabled={busy}
                      title="Remove this team from the season"
                      onClick={() => {
                        if (window.confirm(`Remove ${e.name} from ${season.name}?`)) {
                          void run("removeEntry", { teamId: e.teamId }, `Removed ${e.name}.`);
                        }
                      }}
                      className="rounded-md p-1.5 text-hl-muted hover:bg-hl-red/10 hover:text-hl-red"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Season page details (banner, description, rules, notice). */}
      {season ? (
        <Card className="border-hl-border bg-hl-panel p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-black header-caps text-white">Season page</h2>
            {!details ? (
              <button
                type="button"
                className={secondary}
                onClick={() =>
                  setDetails({
                    name: season.name,
                    bannerUrl: season.bannerUrl ?? "",
                    description: season.description ?? "",
                    rules: season.rules ?? "",
                    notice: season.notice ?? "",
                  })
                }
              >
                Edit
              </button>
            ) : null}
          </div>
          {details ? (
            <div className="space-y-2">
              <input
                value={details.name}
                onChange={(e) => setDetails({ ...details, name: e.target.value.slice(0, 40) })}
                placeholder="Season name"
                className={`${input} w-full`}
              />
              <input
                value={details.bannerUrl}
                onChange={(e) => setDetails({ ...details, bannerUrl: e.target.value.slice(0, 500) })}
                placeholder="Banner image (https://…) — optional"
                className={`${input} w-full`}
              />
              <input
                value={details.notice}
                onChange={(e) => setDetails({ ...details, notice: e.target.value.slice(0, 500) })}
                placeholder="Notice shown on the overview (optional)"
                className={`${input} w-full`}
              />
              <textarea
                value={details.description}
                onChange={(e) => setDetails({ ...details, description: e.target.value.slice(0, 4000) })}
                placeholder="About this season"
                rows={3}
                className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted"
              />
              <textarea
                value={details.rules}
                onChange={(e) => setDetails({ ...details, rules: e.target.value.slice(0, 20000) })}
                placeholder="Rules (shown on the Rules tab): # Section title, - bullet"
                rows={6}
                className="w-full rounded-lg border border-hl-border bg-hl-base px-3 py-2 text-sm text-white placeholder:text-hl-muted"
              />
              <p className="text-[11px] text-hl-muted">
                Easier with a live preview:{" "}
                <Link href={`/league/${season.id}/rules`} className="font-bold text-hl-gold hover:underline">
                  edit on the Rules tab
                </Link>
                .
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className={primary}
                  onClick={async () => {
                    await run("updateDetails", details, "Season page saved.");
                    setDetails(null);
                  }}
                >
                  Save
                </button>
                <button type="button" className={secondary} onClick={() => setDetails(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-hl-muted">
              {season.description ? "Description set. " : "No description yet. "}
              {season.rules ? "Rules set. " : "No rules yet. "}
              {season.bannerUrl ? "Custom banner." : "Default banner."}
            </p>
          )}
        </Card>
      ) : null}

      {/* Where the bot posts. */}
      <Card className="border-hl-border bg-hl-panel p-4">
        <div className="mb-2 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-hl-gold" />
          <h2 className="text-sm font-black header-caps text-white">League channel</h2>
        </div>
        <p className="mb-3 text-xs text-hl-muted">
          The bot posts season steps, results and Match Staff alerts here.{" "}
          {data.channelId ? (channelName ? `Now: #${channelName}.` : "A channel is set.") : "No channel set yet — nothing gets posted."}
        </p>
        {channels === null ? (
          <button type="button" className={secondary} onClick={loadChannels}>
            Choose channel
          </button>
        ) : channels.length === 0 ? (
          <p className="text-xs text-hl-red">Couldn&apos;t read the server&apos;s channels (is the bot token set?).</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={channelPick || data.channelId || ""} onChange={(e) => setChannelPick(e.target.value)} className={input}>
              <option value="" disabled>
                Pick a channel
              </option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !channelPick}
              className={primary}
              onClick={() =>
                run(
                  "setChannel",
                  { channelId: channelPick, channelName: channels.find((c) => c.id === channelPick)?.name ?? "" },
                  "League channel saved."
                )
              }
            >
              Save
            </button>
          </div>
        )}
      </Card>

      {/* Audit log. */}
      <Card className="border-hl-border bg-hl-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-hl-muted" />
          <h2 className="text-sm font-black header-caps text-white">Staff log</h2>
        </div>
        {data.events.length === 0 ? (
          <p className="text-sm text-hl-muted">No staff actions yet.</p>
        ) : (
          <div className="space-y-1">
            {data.events.map((ev) => (
              <div key={ev.id} className="flex flex-wrap gap-x-2 text-xs">
                <span className="tabular-nums text-hl-muted">{fmt(ev.createdAt)}</span>
                <span className="font-bold text-white">{ev.actor ?? "Someone"}</span>
                <span className="text-white/80">{EVENT_TEXT[ev.kind] ?? ev.kind}</span>
                {ev.detail ? <span className="text-hl-muted">— {ev.detail}</span> : null}
                {ev.matchId ? (
                  <Link href={`/league/match/${ev.matchId}`} className="text-hl-gold hover:underline">
                    match
                  </Link>
                ) : null}
                <span className="text-hl-muted">({ev.source === "website" ? "website" : "Discord"})</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Danger zone. */}
      {season && season.status !== "finished" && season.status !== "cancelled" ? (
        <Card className="border-hl-red/40 bg-hl-panel p-4">
          <h2 className="mb-1 text-sm font-black header-caps text-hl-red">Cancel season</h2>
          <p className="mb-3 text-xs text-hl-muted">
            Ends {season.name} for good: no more matches, standings freeze. Type the season name to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={season.name}
              className={input}
            />
            <button
              type="button"
              disabled={busy || confirmName.trim() !== season.name}
              onClick={() => run("cancel", { confirmName }, `${season.name} was cancelled.`)}
              className={`border border-hl-red/60 text-hl-red hover:bg-hl-red/10 ${btn}`}
            >
              Cancel season
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
