"use client";

/**
 * Staff panel → Season (CBL bot docs/STAFF_PANEL_PLAN.md step 7): end the
 * season like /season reset (MatchMaking Manager), with the Top 10 who get the
 * badge, this season so far, and past seasons. /season fullreset (delete
 * everything) stays in Discord.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Crown, Flag, Lock } from "lucide-react";
import { StaffJobOutcome } from "@/components/staff/staff-job-outcome";
import { CardTitle, ConfirmButton, StaffCard, danger, fieldLabel, input } from "@/components/staff/staff-ui";
import { useStaffJob } from "@/components/staff/use-staff-job";
import type { StaffJob, StaffRoles } from "@/lib/staff-jobs";
import type { StaffSeasonView } from "@/lib/staff-season";

type Settled = (job: StaffJob) => void;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const clean = (s: string) => s.trim().replace(/\s+/g, " ");

function EndSeason({ view, canEnd, onSettled }: { view: StaffSeasonView; canEnd: boolean; onSettled: Settled }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏆");
  const [confirm, setConfirm] = useState("");
  const job = useStaffJob(onSettled);
  const seasonName = clean(name);
  const used = view.pastSeasons.some((s) => s.name === seasonName);
  const ready = canEnd && seasonName.length >= 2 && emoji.trim() && !used && clean(confirm) === seasonName;
  const example = view.top10[0]?.name ?? "player";

  return (
    <StaffCard>
      <CardTitle
        icon={<Flag className="h-4 w-4 text-hl-gold" />}
        title="End the season"
        hint="Same as /season reset. It can't be undone."
        right={
          !canEnd ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[0.6875rem] font-bold text-hl-muted">
              <Lock className="h-3 w-3" /> MatchMaking Manager
            </span>
          ) : null
        }
      />
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs text-[#d4d4d4]">
        <li>
          The Top 10 on the right each get the badge{" "}
          <span className="font-semibold text-white">
            &ldquo;{seasonName || "Season name"} {emoji.trim() || "🏆"} CBL C | {example}&rdquo;
          </span>
          .
        </li>
        <li>The season&apos;s Champion / Top 3 / Top 10 items are given out on the website.</li>
        <li>Everyone&apos;s stats are saved under the season name (players can look them up later).</li>
        <li>Elo, ranks and placements go back to zero for everyone. Match history and career stats stay.</li>
        <li>Live match rooms on the website are cleared.</li>
      </ol>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <label className="block">
          <span className={fieldLabel}>Season name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="e.g. Season 1"
            disabled={!canEnd}
            className={`${input} w-full`}
          />
          {used ? <span className="mt-1 block text-xs text-hl-red">That name was already used for a past season.</span> : null}
        </label>
        <label className="block">
          <span className={fieldLabel}>Badge emoji</span>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 16))} disabled={!canEnd} className={`${input} w-full`} />
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>Type the season name again to confirm</span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value.slice(0, 60))} disabled={!canEnd} className={`${input} w-full`} />
        </label>
      </div>
      <div className="mt-4">
        <ConfirmButton
          className={danger}
          confirmText="Last click: end the season"
          disabled={!ready || job.busy}
          onConfirm={() => void job.run("season_end", { season_name: seasonName, badge_emoji: emoji.trim(), confirm_name: clean(confirm) })}
        >
          End the season
        </ConfirmButton>
      </div>
      <div className="mt-3">
        <StaffJobOutcome state={job.state} />
      </div>
      <p className="mt-4 text-[0.6875rem] text-hl-muted">
        Deleting everything (/season fullreset) stays in Discord on purpose.
      </p>
    </StaffCard>
  );
}

export function SeasonTab({ roles, onSettled }: { roles: StaffRoles; onSettled: () => void }) {
  const [view, setView] = useState<StaffSeasonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/season", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as StaffSeasonView & { error?: string };
        if (!alive) return;
        if (res.ok) {
          setView(json);
          setError(null);
        } else {
          setError(json.error || "Couldn't load the season tab.");
        }
      })
      .catch(() => alive && setError("Couldn't load the season tab."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const settled = useCallback(() => {
    onSettled();
    setReload((n) => n + 1);
  }, [onSettled]);

  if (error && !view) return <p className="text-sm text-hl-red">{error}</p>;
  if (!view) return <div className="py-10 text-center text-sm text-hl-muted">Loading…</div>;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <EndSeason view={view} canEnd={roles.manager} onSettled={settled} />
      <div className="space-y-5">
        <StaffCard>
          <CardTitle
            icon={<Crown className="h-4 w-4 text-hl-gold" />}
            title="Top 10 right now"
            hint={`${view.since ? `Since ${fmtDate(view.since)}: ` : ""}${view.rankedMatches} ranked matches, ${view.placedPlayers} players placed.`}
          />
          {!view.top10.length ? (
            <p className="text-sm text-hl-muted">No players yet.</p>
          ) : (
            <ol className="divide-y divide-hl-border">
              {view.top10.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 py-2 text-sm">
                  <span className={`w-5 text-right font-black ${i < 3 ? "text-hl-gold" : "text-hl-muted"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-white">{p.name}</span>
                  <span className="text-xs text-hl-muted">
                    {p.matchesWon}/{p.matchesPlayed} won
                  </span>
                  <span className="w-14 text-right font-bold text-white">{p.elo.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </StaffCard>
        <StaffCard>
          <CardTitle icon={<CalendarClock className="h-4 w-4 text-hl-gold" />} title="Past seasons" />
          {!view.pastSeasons.length ? (
            <p className="text-sm text-hl-muted">No season has ended yet.</p>
          ) : (
            <ul className="divide-y divide-hl-border">
              {view.pastSeasons.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate font-semibold text-white">{s.name}</span>
                  <span className="shrink-0 text-xs text-hl-muted">
                    {s.endedAt ? fmtDate(s.endedAt) : "date unknown"} · {s.players} players saved
                  </span>
                </li>
              ))}
            </ul>
          )}
        </StaffCard>
      </div>
    </div>
  );
}
