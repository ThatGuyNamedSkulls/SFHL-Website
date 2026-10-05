"use client";

/**
 * The staff panel (CBL bot: docs/STAFF_PANEL_PLAN.md). Every action is sent to
 * the Discord bot, which runs the same code as the slash command; this is just
 * the forms and the log. Tabs: Players (step 2), Ranking (step 3), Queue (step 6),
 * Moderation (step 4), Teams (step 6), Shop (step 5, Administrators), Season (step 7,
 * MatchMaking Manager), Recent actions.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Gavel, History, ListOrdered, RefreshCw, Shield, Store, Trophy, Users } from "lucide-react";
import { PlayersTab } from "@/components/staff/players-tab";
import { ModerationTab } from "@/components/staff/moderation-tab";
import { RankingTab } from "@/components/staff/ranking-tab";
import { SeasonTab } from "@/components/staff/season-tab";
import { QueueTab } from "@/components/staff/queue-tab";
import { ShopTab } from "@/components/staff/shop-tab";
import { TeamsTab } from "@/components/staff/teams-tab";
import { jobHeadline } from "@/components/staff/staff-job-outcome";
import { CardTitle, StaffCard } from "@/components/staff/staff-ui";
import { timeAgo } from "@/lib/format";
import type { StaffJob, StaffJobStatus, StaffRoles } from "@/lib/staff-jobs";

export type StaffTab = "players" | "ranking" | "queue" | "moderation" | "teams" | "shop" | "season" | "recent";

const TABS: { id: StaffTab; label: string; icon: typeof Users }[] = [
  { id: "players", label: "Players", icon: Users },
  { id: "ranking", label: "Ranking", icon: Trophy },
  { id: "queue", label: "Queue", icon: ListOrdered },
  { id: "moderation", label: "Moderation", icon: Gavel },
  { id: "teams", label: "Teams", icon: Shield },
  { id: "shop", label: "Shop", icon: Store },
  { id: "season", label: "Season", icon: CalendarClock },
  { id: "recent", label: "Recent actions", icon: History },
];

const STATUS: Record<StaffJobStatus, { text: string; cls: string }> = {
  pending: { text: "Waiting", cls: "bg-hl-gold/10 text-hl-gold" },
  running: { text: "Running", cls: "bg-hl-gold/10 text-hl-gold" },
  done: { text: "Done", cls: "bg-hl-green/10 text-hl-green" },
  failed: { text: "Failed", cls: "bg-hl-red/10 text-hl-red" },
  cancelled: { text: "Not run", cls: "bg-white/5 text-hl-muted" },
};

/** One line on what happened: the bot's first reply, or why it failed. */
function jobDetail(job: StaffJob): string | null {
  if (job.status === "pending" || job.status === "running") return null;
  const first = job.result?.messages[0];
  const reply = first?.embeds[0]?.description || first?.embeds[0]?.title || first?.content || null;
  if (job.status === "done") return reply;
  // A refusal from the runner (role, offline...) or a cancel says why itself;
  // a command's own "no" is its reply.
  if (job.result?.error || job.status === "cancelled") return jobHeadline(job).text;
  return reply ?? jobHeadline(job).text;
}

function RecentActions({
  jobs,
  error,
  onRefresh,
}: {
  jobs: StaffJob[] | null;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <StaffCard>
      <CardTitle
        icon={<History className="h-4 w-4 text-hl-gold" />}
        title="Recent actions"
        hint="Everything staff did from the website, newest first."
        right={
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md p-1.5 text-hl-muted hover:bg-hl-panel-light hover:text-white"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      />
      {error ? <p className="text-sm text-hl-red">{error}</p> : null}
      {!jobs && !error ? <p className="text-sm text-hl-muted">Loading…</p> : null}
      {jobs && !jobs.length ? <p className="text-sm text-hl-muted">Nothing yet.</p> : null}
      {jobs?.length ? (
        <ul className="divide-y divide-hl-border">
          {jobs.map((job) => {
            const status = STATUS[job.status] ?? STATUS.failed;
            const detail = jobDetail(job);
            return (
              <li key={job.id} className="flex items-start gap-3 py-2.5">
                <span className={`mt-0.5 w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[0.6875rem] font-bold ${status.cls}`}>
                  {status.text}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{job.summary}</div>
                  {detail ? (
                    <div className={`truncate text-xs ${job.status === "failed" ? "text-hl-red/90" : "text-hl-muted"}`}>
                      {detail}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-[0.6875rem] text-hl-muted">
                  <div>{job.requestedByName || "staff"}</div>
                  <div>{timeAgo(job.createdAt)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </StaffCard>
  );
}

/** Set or clear one query parameter without a navigation (?tab=, ?player=). */
function setUrlParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function StaffPanel({
  roles,
  initialTab = "players",
  initialPlayer = null,
}: {
  roles: StaffRoles;
  initialTab?: StaffTab;
  initialPlayer?: string | null;
}) {
  const [tab, setTab] = useState<StaffTab>(initialTab);
  // A tab loads its data the first time it's opened, then stays mounted.
  const [opened, setOpened] = useState<Set<StaffTab>>(() => new Set([initialTab, "recent"]));
  const [jobs, setJobs] = useState<StaffJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/jobs", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { jobs?: StaffJob[]; error?: string };
        if (!alive) return;
        if (res.ok) {
          setJobs(json.jobs ?? []);
          setError(null);
        } else {
          setError(json.error || "Couldn't load recent actions.");
        }
      })
      .catch(() => alive && setError("Couldn't load recent actions."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const choose = useCallback((next: StaffTab) => {
    setTab(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
    setUrlParam("tab", next === "players" ? null : next);
  }, []);

  // The open player lives here so any tab can open one (Moderation → a name).
  const [player, setPlayer] = useState<string | null>(initialPlayer);
  const selectPlayer = useCallback((name: string | null) => {
    setPlayer(name);
    setUrlParam("player", name);
  }, []);
  const openPlayer = useCallback(
    (name: string) => {
      selectPlayer(name);
      choose("players");
    },
    [selectPlayer, choose]
  );

  return (
    <div>
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-hl-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => choose(id)}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-black header-caps ${
              tab === id ? "border-hl-gold text-white" : "border-transparent text-hl-muted hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === "recent" && jobs?.[0]?.status === "failed" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-hl-red" title="The latest action failed" />
            ) : null}
          </button>
        ))}
      </div>
      {/* Opened tabs stay mounted so a tab switch keeps the open player and its forms. */}
      {opened.has("players") ? (
        <div hidden={tab !== "players"}>
          <PlayersTab roles={roles} selected={player} onSelect={selectPlayer} onSettled={refresh} />
        </div>
      ) : null}
      {opened.has("ranking") ? (
        <div hidden={tab !== "ranking"}>
          {roles.staff ? (
            <RankingTab onSettled={refresh} />
          ) : (
            <p className="text-sm text-hl-muted">Ranking needs the Match Staff role.</p>
          )}
        </div>
      ) : null}
      {opened.has("queue") ? (
        <div hidden={tab !== "queue"}>
          {roles.staff ? (
            <QueueTab onSettled={refresh} />
          ) : (
            <p className="text-sm text-hl-muted">The queue needs the Match Staff role.</p>
          )}
        </div>
      ) : null}
      {opened.has("teams") ? (
        <div hidden={tab !== "teams"}>
          {roles.staff ? (
            <TeamsTab onSettled={refresh} />
          ) : (
            <p className="text-sm text-hl-muted">Team titles need the Match Staff role.</p>
          )}
        </div>
      ) : null}
      {opened.has("moderation") ? (
        <div hidden={tab !== "moderation"}>
          {roles.staff ? (
            <ModerationTab onOpenPlayer={openPlayer} />
          ) : (
            <p className="text-sm text-hl-muted">Moderation needs the Match Staff role.</p>
          )}
        </div>
      ) : null}
      {opened.has("season") ? (
        <div hidden={tab !== "season"}>
          <SeasonTab roles={roles} onSettled={refresh} />
        </div>
      ) : null}
      {opened.has("shop") ? (
        <div hidden={tab !== "shop"}>
          {roles.admin ? (
            <ShopTab onSettled={refresh} />
          ) : (
            <p className="text-sm text-hl-muted">The shop is for server Administrators, like the /item commands.</p>
          )}
        </div>
      ) : null}
      <div hidden={tab !== "recent"}>
        <RecentActions jobs={jobs} error={error} onRefresh={refresh} />
      </div>
    </div>
  );
}
