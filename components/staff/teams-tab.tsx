"use client";

/**
 * Staff panel → Teams (CBL bot docs/STAFF_PANEL_PLAN.md step 6): every website
 * team with its titles (cup wins etc.); award or take away a title, like
 * /teamtitle award · remove.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Search, Trophy, X } from "lucide-react";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import { CardTitle, ConfirmButton, StaffCard, input, primary } from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import type { StaffJob } from "@/lib/staff-jobs";
import type { StaffTeam } from "@/lib/staff-teams";

type Settled = (job: StaffJob) => void;

const MAX_TITLE = 60;

function TeamLogo({ team }: { team: StaffTeam }) {
  const [broken, setBroken] = useState(false);
  if (team.logoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.logoUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-md border border-hl-border object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hl-border bg-hl-base text-[0.6875rem] font-black text-hl-muted">
      {(team.tag || team.name).slice(0, 3).toUpperCase()}
    </span>
  );
}

function TeamDetail({ team, onSettled }: { team: StaffTeam; onSettled: Settled }) {
  const [title, setTitle] = useState("");
  const award = useStaffJob((job) => {
    onSettled(job);
    if (job.status === "done") setTitle("");
  });
  const remove = useStaffJob(onSettled);
  const clean = title.trim().replace(/\s+/g, " ");
  return (
    <StaffCard>
      <div className="mb-4 flex items-center gap-3">
        <TeamLogo team={team} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-black text-white">
            {team.name} {team.tag ? <span className="text-sm font-bold text-hl-muted">[{team.tag}]</span> : null}
          </div>
          <div className="text-xs text-hl-muted">
            {team.members} member{team.members === 1 ? "" : "s"} · {team.titles.length} title{team.titles.length === 1 ? "" : "s"}
          </div>
        </div>
        <Link href={`/teams/${encodeURIComponent(team.id)}`} className="inline-flex items-center gap-1 text-xs text-hl-muted hover:text-white">
          Team page <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <h3 className="mb-2 text-xs font-bold header-caps text-hl-muted">Titles</h3>
      {team.titles.length ? (
        <ul className="mb-4 divide-y divide-hl-border">
          {team.titles.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <Trophy className="h-4 w-4 shrink-0 text-hl-gold" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{t.title}</div>
                <div className="text-[0.6875rem] text-hl-muted">
                  {t.awardedAt ? new Date(t.awardedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}
                  {t.awardedBy ? ` · by ${t.awardedBy}` : ""}
                </div>
              </div>
              <ConfirmButton
                className="inline-flex h-8 items-center gap-1 rounded-md border border-hl-border px-2 text-xs font-bold text-hl-muted hover:border-hl-red/50 hover:text-hl-red disabled:opacity-40"
                confirmText="Remove?"
                disabled={remove.busy}
                onConfirm={() =>
                  void remove.run("team_title_remove", { team: team.id, title_id: t.id, team_name: team.name, title: t.title })
                }
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Remove</span>
              </ConfirmButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-hl-muted">No titles yet.</p>
      )}
      <div className="mb-3">
        <StaffJobOutcome state={remove.state} />
      </div>

      <h3 className="mb-2 text-xs font-bold header-caps text-hl-muted">Award a title</h3>
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
          placeholder="e.g. Season 1 Cup Champions"
          aria-label="Title"
          className={`${input} min-w-0 flex-1`}
        />
        <button
          type="button"
          className={primary}
          disabled={clean.length < 2 || award.busy}
          onClick={() => void award.run("team_title_award", { team: team.id, title: clean, team_name: team.name })}
        >
          <Trophy className="h-3.5 w-3.5" /> Award
        </button>
      </div>
      <p className="mt-1.5 text-[0.6875rem] text-hl-muted">Shown on the team page. Same as /teamtitle award.</p>
      <div className="mt-3">
        <StaffJobOutcome state={award.state} />
      </div>
    </StaffCard>
  );
}

export function TeamsTab({ onSettled }: { onSettled: () => void }) {
  const [teams, setTeams] = useState<StaffTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/teams", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { teams?: StaffTeam[]; error?: string };
        if (!alive) return;
        if (res.ok) {
          setTeams(json.teams ?? []);
          setError(null);
        } else {
          setError(json.error || "Couldn't load the teams tab.");
        }
      })
      .catch(() => alive && setError("Couldn't load the teams tab."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const settled = useCallback(() => {
    onSettled();
    setReload((n) => n + 1);
  }, [onSettled]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = teams ?? [];
    return q ? all.filter((t) => `${t.name} ${t.tag}`.toLowerCase().includes(q)) : all;
  }, [teams, query]);

  if (error && !teams) return <p className="text-sm text-hl-red">{error}</p>;
  if (!teams) return <div className="py-10 text-center text-sm text-hl-muted">Loading…</div>;
  const team = teams.find((t) => t.id === selected) ?? null;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <StaffCard>
        <CardTitle icon={<Trophy className="h-4 w-4 text-hl-gold" />} title="Teams" hint={`${teams.length} website teams. Pick one to manage its titles.`} />
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hl-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or tag" className={`${input} w-full pl-8`} />
        </div>
        {!shown.length ? (
          <p className="text-sm text-hl-muted">{teams.length ? "No team matches." : "No teams yet."}</p>
        ) : (
          <ul className="max-h-[36rem] divide-y divide-hl-border overflow-y-auto">
            {shown.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t.id)}
                  aria-pressed={t.id === selected}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left ${
                    t.id === selected ? "bg-hl-panel-light" : "hover:bg-hl-panel-light/50"
                  }`}
                >
                  <TeamLogo team={t} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">
                      {t.name} {t.tag ? <span className="text-xs text-hl-muted">[{t.tag}]</span> : null}
                    </div>
                    <div className="text-xs text-hl-muted">
                      {t.members} member{t.members === 1 ? "" : "s"}
                    </div>
                  </div>
                  {t.titles.length ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-hl-gold">
                      <Trophy className="h-3.5 w-3.5" /> {t.titles.length}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </StaffCard>
      {team ? (
        <TeamDetail key={team.id} team={team} onSettled={settled} />
      ) : (
        <div className="rounded-xl border border-dashed border-hl-border px-6 py-10 text-center text-sm text-hl-muted">
          Pick a team to award or remove titles.
        </div>
      )}
    </div>
  );
}
