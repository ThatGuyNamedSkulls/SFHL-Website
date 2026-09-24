import { notFound } from "next/navigation";
import { LeagueDivisionSelect } from "@/components/league-division-select";
import {
  FinalResults,
  PlayoffBracket,
  RegularSchedule,
  RegularTable,
  StageStepper,
  type Countries,
} from "@/components/league-standings";
import { getSession } from "@/lib/auth";
import { leagueView, seasonEventTimes, teamCountries } from "@/lib/league";
import { defaultStage, parseStage, standingsStages, type StageKey } from "@/lib/league-standings";

export const dynamic = "force-dynamic";

/**
 * Standings (docs/LEAGUE_UI_PLAN.md step 4): a division filter and the stage
 * stepper — Regular season (table + matches) → Playoffs (bracket) → Final
 * results (places + prizes). ?division= and ?stage=regular|playoffs|final.
 */
export default async function SeasonStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { season: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const query = await searchParams;
  const session = await getSession();
  const view = await leagueView(Number(raw), session?.discordId ?? null);
  if (!view.season || view.season.id !== Number(raw)) notFound();
  const season = view.season;
  const base = `/league/${season.id}/standings`;

  if (!view.divisions.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.12] px-4 py-14 text-center text-sm text-white/55">
        {season.status === "cancelled"
          ? "This season was cancelled before the divisions were drawn."
          : "Standings appear once Match Staff draw the divisions."}
      </div>
    );
  }

  const myTeamIds = view.viewer?.myTeamIds ?? [];
  const wanted = typeof query.division === "string" && /^\d+$/.test(query.division) ? Number(query.division) : null;
  const div =
    view.divisions.find((d) => d.id === wanted) ??
    view.divisions.find((d) => d.standings.some((r) => myTeamIds.includes(r.teamId))) ??
    view.divisions[0];

  const events = await seasonEventTimes(season.id);
  const playoffMatches = Object.values(div.playoffs ?? {}).flatMap((m) =>
    m ? [{ round: m.round, status: m.status }] : []
  );
  const stages = standingsStages({ season, playoffs: playoffMatches, placed: div.places.length, events });
  const asked = parseStage(query.stage);
  const stage: StageKey = asked ?? defaultStage(stages);
  const stageState = stages.find((s) => s.key === stage)!.state;

  const rosters = new Map(
    view.entries.filter((e) => e.divisionId === div.id).map((e) => [e.teamId, e.roster])
  );
  const countries: Countries = Object.fromEntries(await teamCountries(rosters));

  const myDivisionIds = new Set(
    view.divisions.filter((d) => d.standings.some((r) => myTeamIds.includes(r.teamId))).map((d) => d.id)
  );
  const hrefFor = (key: StageKey) => `${base}?${new URLSearchParams({ division: String(div.id), stage: key })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {view.divisions.length > 1 ? (
          <LeagueDivisionSelect
            base={base}
            keep={{ stage: asked }}
            value={String(div.id)}
            options={view.divisions.map((d) => ({
              value: String(d.id),
              label: `${d.name}${myDivisionIds.has(d.id) ? " · your team" : ""}`,
            }))}
          />
        ) : (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Division</div>
            <div className="mt-1 text-lg font-black text-white">{div.name}</div>
          </div>
        )}
        <StageStepper stages={stages} active={stage} hrefFor={hrefFor} />
      </div>

      {stage === "regular" ? (
        <>
          <RegularTable div={div} countries={countries} myTeamIds={myTeamIds} />
          <RegularSchedule div={div} />
        </>
      ) : stage === "playoffs" ? (
        <PlayoffBracket div={div} state={stageState} myTeamIds={myTeamIds} />
      ) : (
        <FinalResults div={div} countries={countries} myTeamIds={myTeamIds} />
      )}
    </div>
  );
}
