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

interface AdminData {
  season: {
    id: number;
    name: string;
    status: SeasonStatus;
    signupClose: number | null;
    startDate: number | null;
    weeks: number;
  } | null;
  canCreate: boolean;
  entries: {
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

interface StartPlan {
  firstWeek: number;
  ok: boolean;
  divisions: { id: number; name: string; teams: number; matches: number; problem: string | null }[];
}

const EVENT_TEXT: Record<string, string> = {
  season_created: "created the season",
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

export function LeagueManage({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<AdminData | null>(null);
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
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [channelPick, setChannelPick] = useState("");

  useEffect(() => {
    let alive = true;
    apiGetJson<AdminData & { error?: string }>("/api/league/admin", { force: true })
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
  }, [reload]);

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
    invalidateClientApi();
    setReload((n) => n + 1);
    onChanged();
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
  const channelName = channels?.find((c) => c.id === data.channelId)?.name;

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      {notice ? <p className="text-sm text-hl-green">{notice}</p> : null}

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

        {season?.status === "regular" || season?.status === "playoffs" ? (
          <p className="text-sm text-white">
            The {season.status === "regular" ? "regular season" : "playoffs"} is running. The bot opens match rooms,
            sends reminders and sets default slots on its own — you only need to handle what shows up under
            &ldquo;Needs staff&rdquo;.
          </p>
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
