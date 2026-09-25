import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { LeagueDivisionPicker } from "@/components/league-division-select";
import { CountryCell, Empty, TeamCell, ordinal } from "@/components/league-standings";
import { getSession } from "@/lib/auth";
import { UPCOMING_STATUSES, getSeason, seasonDivisions } from "@/lib/league";
import { conferenceGroups, filterPicker, parseDivisionFilter } from "@/lib/league-standings";
import { STATUS_LABEL, leagueTeams, parseTeamsFilter, statusCounts, type TeamsFilter } from "@/lib/league-teams";
import type { EntryStatus } from "@/lib/league";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<EntryStatus, string> = {
  active: "border-hl-green/40 bg-hl-green/10 text-hl-green",
  signed_up: "border-white/20 bg-white/[0.06] text-white/80",
  ineligible: "border-hl-red/40 bg-hl-red/10 text-hl-red",
};

/**
 * Teams (docs/LEAGUE_UI_PLAN.md step 5): every team in the season with its
 * country, league status, division and entry status. ?division= (an id, or a
 * split division's code for all its conferences) and ?status=.
 */
export default async function SeasonTeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { season: raw } = await params;
  const season = /^\d+$/.test(raw) ? await getSeason(Number(raw)) : null;
  if (!season) notFound();
  const query = await searchParams;
  const session = await getSession();

  const [all, divisions] = await Promise.all([leagueTeams(season.id, session?.discordId ?? null), seasonDivisions(season.id)]);
  const groups = conferenceGroups(divisions);
  const filter = parseDivisionFilter(query.division, groups);
  const status = parseTeamsFilter(query.status);
  const inDivision = filter.ids ? all.filter((r) => r.division && filter.ids!.includes(r.division.id)) : all;
  const rows = status === "all" ? inDivision : inDivision.filter((r) => r.status === status);
  const counts = statusCounts(inDivision);
  const finished = season.status === "finished";

  const base = `/league/${season.id}/teams`;
  const href = (s: TeamsFilter) => {
    const q = new URLSearchParams();
    if (filter.value) q.set("division", filter.value);
    if (s !== "all") q.set("status", s);
    return q.size ? `${base}?${q}` : base;
  };
  const chips = (["all", "active", "signed_up", "ineligible"] as TeamsFilter[]).filter(
    (s) => s === "all" || counts[s] > 0 || s === status
  );
  const th = "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {divisions.length ? (
          <LeagueDivisionPicker
            base={base}
            keep={{ status: status === "all" ? null : status }}
            picker={filterPicker(groups, filter)}
          />
        ) : (
          <div />
        )}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Team status">
          {chips.map((s) => {
            const on = s === status;
            return (
              <Link
                key={s}
                href={href(s)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-black ${
                  on ? "border-[#ff5500] bg-[#ff5500]/15 text-white" : "border-white/[0.12] text-white/70 hover:text-white"
                }`}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]}
                <span className={on ? "text-[#ff5500]" : "text-white/45"}>{counts[s]}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>
          {all.length === 0 ? (
            UPCOMING_STATUSES.includes(season.status) ? (
              <>
                No teams have signed up yet. Captains can sign up on the{" "}
                <Link href={`/league/${season.id}`} className="font-bold text-[#ff5500] hover:underline">
                  Overview
                </Link>
                .
              </>
            ) : (
              "No teams took part in this season."
            )
          ) : (
            "No teams match these filters."
          )}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#121212]">
          <table className="w-full text-sm md:min-w-[760px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left">
                <th className={`${th} pl-4 sm:pl-5`}>Team</th>
                <th className={`${th} hidden w-28 md:table-cell`}>Country</th>
                <th className={`${th} hidden w-48 sm:table-cell`}>League status</th>
                <th className={`${th} w-44`}>Division</th>
                <th className={`${th} hidden w-20 text-center md:table-cell`}>Players</th>
                <th className={`${th} pr-4 text-right sm:w-40 sm:pr-5`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.team.id}
                  className={`border-t border-white/[0.05] first:border-t-0 ${r.mine ? "bg-[#ff5500]/[0.07]" : "hover:bg-white/[0.02]"}`}
                >
                  <td className="py-2.5 pl-4 pr-3 sm:pl-5">
                    <div className="flex min-w-0 items-center gap-2">
                      <TeamCell team={r.team} mine={r.mine} />
                      {r.mine ? (
                        <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-[#ff5500]">
                          Your team
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 md:table-cell">
                    <CountryCell code={r.country} />
                  </td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-white/85"
                      title={r.inviteOnly ? "Earned status (promotion/relegation), or set by Match Staff" : "Placed by the team's skill (top-5 average Elo)"}
                    >
                      {r.inviteOnly ? <Lock className="h-3 w-3 text-[#ff5500]" /> : null}
                      {r.access}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.division ? (
                      <Link
                        href={`/league/${season.id}/standings?division=${r.division.id}`}
                        className="text-xs font-bold text-white hover:text-[#ff5500] hover:underline"
                      >
                        {r.division.name}
                        {finished && r.finalPlace ? (
                          <span className="ml-1.5 font-semibold text-white/55">· {ordinal(r.finalPlace)}</span>
                        ) : null}
                      </Link>
                    ) : (
                      <span className="text-xs text-white/40">{r.status === "signed_up" ? "After the draw" : "—"}</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 text-center tabular-nums text-white/80 md:table-cell" title={r.players.join(", ")}>
                    {r.players.length}
                  </td>
                  <td className="py-2.5 pl-3 pr-4 text-right sm:pr-5">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-black ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                    {r.status === "ineligible" && r.note ? (
                      <div className="mt-1 text-[11px] text-hl-red/90 first-letter:uppercase">{r.note}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
